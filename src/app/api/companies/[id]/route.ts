import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, uploadedSamples, templateVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const samples = await db
    .select()
    .from(uploadedSamples)
    .where(eq(uploadedSamples.companyId, id))
    .orderBy(desc(uploadedSamples.uploadedAt));

  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.companyId, id))
    .orderBy(desc(templateVersions.versionNumber));

  return NextResponse.json({ company, samples, versions });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const db = await getDb();
  const [existing] = await db.select().from(companies).where(eq(companies.id, id));
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.update(companies).set({ name }).where(eq(companies.id, id));
  return NextResponse.json({ company: { ...existing, name } });
}
