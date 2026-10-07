import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { templateVersions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: companyId, versionId } = await context.params;
  const db = await getDb();
  const [version] = await db
    .select()
    .from(templateVersions)
    .where(and(eq(templateVersions.id, versionId), eq(templateVersions.companyId, companyId)));
  if (!version) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ templateVersion: version });
}
