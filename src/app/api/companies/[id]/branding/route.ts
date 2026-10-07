import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { putFile, deleteFile, brandingKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

/**
 * Manual, reliable logo/signature upload — the primary path. Always
 * available regardless of whether PDF-based extraction (see
 * pipeline/analyze.ts) finds anything. Multipart body:
 *   logo?: File, removeLogo?: "true"
 *   signature?: File, removeSignature?: "true"
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const db = await getDb();
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return NextResponse.json({ error: "company not found" }, { status: 404 });

  const form = await req.formData();
  const updates: Partial<{ logoR2Key: string | null; signatureR2Key: string | null }> = {};

  for (const [field, dbColumn, existingKey] of [
    ["logo", "logoR2Key", company.logoR2Key],
    ["signature", "signatureR2Key", company.signatureR2Key],
  ] as const) {
    const removeFlag = form.get(`remove${field[0].toUpperCase()}${field.slice(1)}`);
    const file = form.get(field);

    if (removeFlag === "true") {
      if (existingKey) await deleteFile(existingKey).catch(() => {});
      updates[dbColumn] = null;
      continue;
    }
    if (file instanceof File && file.size > 0) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: `${field}: unsupported file type "${file.type}" (use PNG, JPEG, or WEBP)` },
          { status: 400 }
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = brandingKey(companyId, field, extFor(file.type));
      const fileUrl = await putFile(key, bytes, file.type);
      if (existingKey) await deleteFile(existingKey).catch(() => {});
      updates[dbColumn] = fileUrl;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(companies).set(updates).where(eq(companies.id, companyId));
  }

  const [updated] = await db.select().from(companies).where(eq(companies.id, companyId));
  return NextResponse.json({ company: updated });
}
