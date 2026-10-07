import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "@/db/client";
import { uploadedSamples, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isSampleBlobUrl } from "@/lib/storage";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { ProviderUnavailableError } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
// Stage B only: primary text model (up to 60s) plus its fallback (up to 60s).
export const maxDuration = 180;

const extractionSchema = z.object({
  rawText: z.string().max(200_000),
  layoutHints: z.object({ description: z.string().max(2_000) }),
});

const bodySchema = z.object({
  samples: z
    .array(
      z.object({
        blobUrl: z.string().url(),
        originalFilename: z.string().min(1).max(300),
        pages: z.array(extractionSchema).min(1).max(200),
      })
    )
    .min(1)
    .max(10),
  updateBranding: z.boolean().default(false),
  logoCropBase64: z.string().max(3_000_000).optional(),
  signatureCropBase64: z.string().max(3_000_000).optional(),
});

/**
 * JSON body: every sample PDF has already been uploaded straight to Blob
 * from the browser, and every page already read via /extract-page, so this
 * request is small no matter how big the PDFs were. Records the samples and
 * runs Stage B, returning the new pending_review template_version.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "samples (with blobUrl and pages) are required" }, { status: 400 });
  }
  const body = parsed.data;
  if (body.samples.some((s) => !isSampleBlobUrl(s.blobUrl, companyId))) {
    return NextResponse.json({ error: "sample file was not uploaded for this company" }, { status: 400 });
  }

  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return NextResponse.json({ error: "company not found" }, { status: 404 });

  const samples = body.samples.map((s) => ({ sampleId: nanoid(), ...s }));
  await db.insert(uploadedSamples).values(
    samples.map((s) => ({
      id: s.sampleId,
      companyId,
      r2Key: s.blobUrl,
      originalFilename: s.originalFilename,
    }))
  );

  try {
    const version = await runAnalysis({
      companyId,
      samples: samples.map((s) => ({ sampleId: s.sampleId, pages: s.pages })),
      updateBranding: body.updateBranding,
      logoCropBytes: body.logoCropBase64 ? base64ToBytes(body.logoCropBase64) : undefined,
      signatureCropBytes: body.signatureCropBase64
        ? base64ToBytes(body.signatureCropBase64)
        : undefined,
    });
    return NextResponse.json({ templateVersion: version }, { status: 201 });
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
