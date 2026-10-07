import { nanoid } from "nanoid";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { templateVersions, uploadedSamples, companies } from "@/db/schema";
import { getActiveImageToTextProvider, getActiveTextAnalysisProvider } from "@/lib/ai/registry";
import type { StageBResult, TemplateAssets } from "@/lib/template-schema";
import type { ExtractionResult } from "@/lib/ai/types";
import { putFile, assetKey } from "@/lib/storage";

export async function getLatestApprovedTemplate(companyId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.companyId, companyId), eq(templateVersions.status, "approved")))
    .orderBy(desc(templateVersions.versionNumber))
    .limit(1);
  return row ?? null;
}

async function getNextVersionNumber(companyId: string): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.companyId, companyId))
    .orderBy(desc(templateVersions.versionNumber))
    .limit(1);
  return (row?.versionNumber ?? 0) + 1;
}

/**
 * Stage A (per sample, per page) + Stage B (structural analysis across all
 * samples, with the prior approved template as context for incremental
 * re-learning) -> a new `pending_review` template_version row.
 *
 * Never touches `companies.active_template_version_id` — that only moves on
 * explicit human approval (see pipeline/approve.ts).
 */
export async function runAnalysis(params: {
  companyId: string;
  samples: Array<{ sampleId: string; originalFilename: string; pngPages: string[] }>;
  /** Owner opted in to replacing logo/signature/terms from THIS upload. */
  updateBranding?: boolean;
  /** Pre-cropped (client-side) logo image, only present when updateBranding && detection found one. */
  logoCropBytes?: Uint8Array;
  signatureCropBytes?: Uint8Array;
}) {
  const { companyId, samples, updateBranding = false, logoCropBytes, signatureCropBytes } = params;
  if (samples.length === 0) throw new Error("No samples to analyze");

  const visionProvider = await getActiveImageToTextProvider();
  const textProvider = await getActiveTextAnalysisProvider();

  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error("Company not found");

  const priorVersionRow = await getLatestApprovedTemplate(companyId);
  const priorTemplate: StageBResult | undefined = priorVersionRow
    ? {
        layout: priorVersionRow.extractedLayout,
        variableFields: priorVersionRow.variableFields,
        pricingLogic: priorVersionRow.pricingLogic ?? undefined,
      }
    : undefined;

  // Stage A fans out across every sample and every page within it — each
  // call is independent (round-robins across the 4 API keys), so running
  // them concurrently instead of one-at-a-time is a straight latency win
  // whenever more than one sample/page is uploaded together.
  const combinedPerSample = await Promise.all(
    samples.map(async (sample) => {
      const pageResults = await Promise.all(
        sample.pngPages.map((png, i) => visionProvider.extractFromImage(png, i))
      );
      const combined: ExtractionResult = {
        rawText: pageResults.map((p) => p.rawText).join("\n\n"),
        layoutHints: {
          description: pageResults.map((p) => p.layoutHints.description).join(" | "),
        },
      };
      return { sampleId: sample.sampleId, combined };
    })
  );

  const perSampleExtractions = combinedPerSample.map((s) => s.combined);
  const rawExtraction = combinedPerSample.map((s) => ({
    sampleId: s.sampleId,
    rawText: s.combined.rawText,
    layoutHints: s.combined.layoutHints,
  }));

  const stageBResult = await textProvider.analyzeStructure(perSampleExtractions, priorTemplate);

  // The owner said "don't touch logo/signature/terms this time" — Stage B
  // still re-derives a full layout every run (it has no other way to learn
  // new fields), so splice the PRIOR terms text back in rather than letting
  // whatever this run happened to see silently replace it.
  if (!updateBranding && priorVersionRow) {
    const priorTermsSlot = priorVersionRow.extractedLayout.slots.find((s) => s.slot === "terms");
    if (priorTermsSlot) {
      const idx = stageBResult.layout.slots.findIndex((s) => s.slot === "terms");
      if (idx >= 0) stageBResult.layout.slots[idx] = priorTermsSlot;
      else stageBResult.layout.slots.push(priorTermsSlot);
    }
  }

  const versionNumber = await getNextVersionNumber(companyId);
  const id = nanoid();

  const assets = await resolveAssets({
    companyId,
    versionId: id,
    updateBranding,
    logoCropBytes,
    signatureCropBytes,
    priorAssets: priorVersionRow?.assets ?? null,
  });

  await db.insert(templateVersions).values({
    id,
    companyId,
    versionNumber,
    basedOnVersionId: priorVersionRow?.id ?? null,
    extractedLayout: stageBResult.layout,
    variableFields: stageBResult.variableFields,
    pricingLogic: stageBResult.pricingLogic ?? null,
    assets,
    rawExtraction,
    status: "pending_review",
  });

  // Link the consumed samples to this analysis run.
  await Promise.all(
    samples.map((sample) =>
      db
        .update(uploadedSamples)
        .set({ usedInAnalysisVersionId: id })
        .where(eq(uploadedSamples.id, sample.sampleId))
    )
  );

  const [created] = await db.select().from(templateVersions).where(eq(templateVersions.id, id));
  return created;
}

/**
 * Priority per asset, independently for logo and signature:
 *   1. A fresh crop from THIS upload, if the owner opted in and detection
 *      found one — this is the whole point of saying "yes, update it".
 *   2. Whatever the previously approved version had (carry forward — this
 *      is what "no, keep what I have" means).
 *   3. The manually-uploaded company-wide branding image, if any (covers
 *      the very first analysis, before any version has ever carried one).
 *   4. Nothing — the renderer shows an honest "LOGO NOT SET" placeholder
 *      rather than guessing.
 * Note this only records what THIS analysis run learned — it is not the
 * final word on what renders. A manually-uploaded company Branding image
 * always wins over whatever's stored here (see template-schema.ts's
 * `effectiveAssets`), which is what makes "upload the correct one" a real
 * fix for a bad auto-crop instead of something a later re-analysis quietly
 * overwrites again.
 */
async function resolveAssets(opts: {
  companyId: string;
  versionId: string;
  updateBranding: boolean;
  logoCropBytes?: Uint8Array;
  signatureCropBytes?: Uint8Array;
  priorAssets: TemplateAssets | null;
}): Promise<TemplateAssets | null> {
  const result: TemplateAssets = {};

  if (opts.updateBranding && opts.logoCropBytes) {
    const key = assetKey(opts.companyId, opts.versionId, "logo", "png");
    result.logoR2Key = await putFile(key, opts.logoCropBytes, "image/png");
  } else {
    result.logoR2Key = opts.priorAssets?.logoR2Key ?? undefined;
  }

  if (opts.updateBranding && opts.signatureCropBytes) {
    const key = assetKey(opts.companyId, opts.versionId, "signature", "png");
    result.signatureR2Key = await putFile(key, opts.signatureCropBytes, "image/png");
  } else {
    result.signatureR2Key = opts.priorAssets?.signatureR2Key ?? undefined;
  }

  if (!result.logoR2Key && !result.signatureR2Key) return null;
  return result;
}
