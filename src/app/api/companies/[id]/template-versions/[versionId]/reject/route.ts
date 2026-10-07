import { NextResponse } from "next/server";
import { rejectTemplateVersion } from "@/lib/pipeline/approve";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: companyId, versionId } = await context.params;
  await rejectTemplateVersion({ companyId, templateVersionId: versionId });
  return NextResponse.json({ ok: true });
}
