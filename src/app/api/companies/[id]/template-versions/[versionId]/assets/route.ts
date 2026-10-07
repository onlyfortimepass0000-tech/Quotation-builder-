import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { templateVersions } from "@/db/schema";
import { putFile, assetKey } from "@/lib/storage";
import type { TemplateAssets } from "@/lib/template-schema";

export const dynamic = "force-dynamic";

/**
 * Attaches a logo/signature crop to a template version AFTER it was
 * created, so asset detection (slow, occasionally flaky — a separate
 * NVIDIA model call) never has to sit in the critical path of the main
 * analyze request. The upload flow fires this in parallel with /analyze
 * rather than waiting for it first (see upload-form.tsx) — analysis used
 * to take 2.5+ minutes when these ran sequentially.
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: companyId, versionId } = await context.params;
  const db = await getDb();
  const [version] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.id, versionId), eq(templateVersions.companyId, companyId)));
  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    logoCropBase64?: string;
    signatureCropBase64?: string;
  } | null;
  if (!body?.logoCropBase64 && !body?.signatureCropBase64) {
    return NextResponse.json({ error: "logoCropBase64 or signatureCropBase64 required" }, { status: 400 });
  }

  const assets: TemplateAssets = { ...(version.assets ?? {}) };

  if (body.logoCropBase64) {
    const key = assetKey(companyId, versionId, "logo", "png");
    assets.logoR2Key = await putFile(key, base64ToBytes(body.logoCropBase64), "image/png");
  }
  if (body.signatureCropBase64) {
    const key = assetKey(companyId, versionId, "signature", "png");
    assets.signatureR2Key = await putFile(key, base64ToBytes(body.signatureCropBase64), "image/png");
  }

  await db.update(templateVersions).set({ assets }).where(eq(templateVersions.id, versionId));
  return NextResponse.json({ assets });
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
