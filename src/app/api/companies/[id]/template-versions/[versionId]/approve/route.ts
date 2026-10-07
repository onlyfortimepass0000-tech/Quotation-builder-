import { NextResponse } from "next/server";
import { approveTemplateVersion } from "@/lib/pipeline/approve";
import { variableFieldSchema, pricingLogicSchema, MAX_VARIABLE_FIELDS } from "@/lib/template-schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  editedFields: z.array(variableFieldSchema).max(MAX_VARIABLE_FIELDS).optional(),
  editedPricingLogic: pricingLogicSchema.optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: companyId, versionId } = await context.params;
  const json = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const updated = await approveTemplateVersion({
      companyId,
      templateVersionId: versionId,
      editedFields: parsed.data.editedFields,
      editedPricingLogic: parsed.data.editedPricingLogic,
    });
    return NextResponse.json({ templateVersion: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Approve failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
