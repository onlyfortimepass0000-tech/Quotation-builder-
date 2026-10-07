import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getDb } from "@/db/client";
import { uploadedSamples, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { putFile, sampleKey } from "@/lib/storage";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { ProviderUnavailableError } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Accepts one or more PDF files (field "file", repeated) plus a matching
 * "pngPagesJson" field: JSON.stringify(string[][]), one page-array per file
 * in the same order, rendered client-side (see rasterize-client.ts). Stores
 * each PDF in Vercel Blob, then runs the two-stage analysis pipeline and returns the
 * new pending_review template_version.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return NextResponse.json({ error: "company not found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const pngPagesJson = form.get("pngPagesJson");
  if (files.length === 0 || typeof pngPagesJson !== "string") {
    return NextResponse.json({ error: "file(s) and pngPagesJson are required" }, { status: 400 });
  }

  let pngPagesPerFile: string[][];
  try {
    pngPagesPerFile = JSON.parse(pngPagesJson);
  } catch {
    return NextResponse.json({ error: "pngPagesJson is not valid JSON" }, { status: 400 });
  }
  if (pngPagesPerFile.length !== files.length) {
    return NextResponse.json({ error: "pngPagesJson length must match file count" }, { status: 400 });
  }

  const samples: Array<{ sampleId: string; originalFilename: string; pngPages: string[] }> = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const sampleId = nanoid();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = sampleKey(companyId, sampleId, file.name);
    const fileUrl = await putFile(key, bytes, "application/pdf");
    await db.insert(uploadedSamples).values({
      id: sampleId,
      companyId,
      r2Key: fileUrl,
      originalFilename: file.name,
    });
    samples.push({ sampleId, originalFilename: file.name, pngPages: pngPagesPerFile[i] });
  }

  const updateBranding = form.get("updateBranding") === "true";
  const logoCropBase64 = form.get("logoCropBase64");
  const signatureCropBase64 = form.get("signatureCropBase64");

  try {
    const version = await runAnalysis({
      companyId,
      samples,
      updateBranding,
      logoCropBytes:
        typeof logoCropBase64 === "string" ? base64ToBytes(logoCropBase64) : undefined,
      signatureCropBytes:
        typeof signatureCropBase64 === "string" ? base64ToBytes(signatureCropBase64) : undefined,
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
