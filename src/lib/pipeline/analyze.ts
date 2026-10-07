import { nanoid } from "nanoid";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { templateVersions, uploadedSamples, companies } from "@/db/schema";
import { getActiveTextAnalysisProvider } from "@/lib/ai/registry";
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
 * Stage B prompt budget per sample, in characters (~12k tokens). A long
 * quotation is mostly more rows of the same items table; past this budget
 * the middle pages are left out of the PROMPT (never out of the stored
 * extraction) so the text model stays fast and inside its context window.
 * The first and last pages always go in: header, client block, totals,
 * terms and signature live there.
 */
const STAGE_B_CHARS_PER_SAMPLE = 48_000;

export function combinePagesForPrompt(
  pages: ExtractionResult[],
  budget = STAGE_B_CHARS_PER_SAMPLE
): ExtractionResult {
  const order: number[] = [];
  for (let lo = 0, hi = pages.length - 1; lo <= hi; lo++, hi--) {
    order.push(lo);
    if (hi !== lo) order.push(hi);
  }
  const keep = new Set<number>();
  let used = 0;
  for (const i of order) {
    const size = pages[i].rawText.length;
    // Always keep the first and last page, even if they alone exceed the budget.
    if (keep.size >= 2 && used + size > budget) continue;
    keep.add(i);
    used += size;
  }

  const text: string[] = [];
  const descriptions: string[] = [];
  let skippedFrom = -1;
  const flushSkipped = (end: number) => {
    if (skippedFrom === -1) return;
    const range = skippedFrom === end ? `page ${skippedFrom + 1}` : `pages ${skippedFrom + 1}-${end + 1}`;
    text.push(`[${range} omitted for length — same document continues]`);
    skippedFrom = -1;
  };
  pages.forEach((page, i) => {
    if (!keep.has(i)) {
      if (skippedFrom === -1) skippedFrom = i;
      return;
    }
    flushSkipped(i - 1);
    text.push(page.rawText);
    descriptions.push(page.layoutHints.description);
  });
  flushSkipped(pages.length - 1);

  return {
    rawText: text.join("\n\n"),
    layoutHints: { description: descriptions.join(" | ") },
  };
}

/**
 * Stage B (structural analysis across all samples, with the prior approved
 * template as context for incremental re-learning) -> a new `pending_review`
 * template_version row. Stage A already ran per page via /extract-page.
 *
 * Never touches `companies.active_template_version_id` — that only moves on
 * explicit human approval (see pipeline/approve.ts).
 */
export async function runAnalysis(params: {
  companyId: string;
  /** Stage A output for every page of every sample, in page order. */
  samples: Array<{ sampleId: string; pages: ExtractionResult[] }>;
  /** Owner opted in to replacing logo/signature/terms from THIS upload. */
  updateBranding?: boolean;
  /** Pre-cropped (client-side) logo image, only present when updateBranding && detection found one. */
  logoCropBytes?: Uint8Array;
  signatureCropBytes?: Uint8Array;
}) {
  const { companyId, samples, updateBranding = false, logoCropBytes, signatureCropBytes } = params;
  if (samples.length === 0) throw new Error("No samples to analyze");

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

  const perSampleExtractions = samples.map((s) => combinePagesForPrompt(s.pages));
  // Stored for the review screen + debugging: every page, never truncated.
  const rawExtraction = samples.map((s) => ({
    sampleId: s.sampleId,
    rawText: s.pages.map((p) => p.rawText).join("\n\n"),
    layoutHints: {
      description: s.pages.map((p) => p.layoutHints.description).join(" | "),
    },
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
