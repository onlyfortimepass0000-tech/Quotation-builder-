import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, templateVersions } from "@/db/schema";
import { MAX_VARIABLE_FIELDS, type VariableField, type PricingLogic } from "@/lib/template-schema";

/**
 * Human approval gate. Order matters:
 *   1. persist any edits the reviewer made to the field list / pricing logic
 *   2. supersede whatever was previously approved (if anything)
 *   3. mark this version approved
 *   4. only then flip companies.active_template_version_id
 * so there's never a moment where the active pointer references something
 * other than an approved version.
 */
export async function approveTemplateVersion(params: {
  companyId: string;
  templateVersionId: string;
  editedFields?: VariableField[];
  editedPricingLogic?: PricingLogic;
}) {
  const db = await getDb();

  const [version] = await db
    .select()
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.id, params.templateVersionId),
        eq(templateVersions.companyId, params.companyId)
      )
    );
  if (!version) throw new Error("Template version not found for this company");
  if (version.status !== "pending_review") {
    throw new Error(`Cannot approve a version with status "${version.status}"`);
  }
  if (params.editedFields && params.editedFields.length > MAX_VARIABLE_FIELDS) {
    throw new Error(`A template can have at most ${MAX_VARIABLE_FIELDS} variable fields`);
  }

  if (params.editedFields || params.editedPricingLogic) {
    await db
      .update(templateVersions)
      .set({
        ...(params.editedFields ? { variableFields: params.editedFields } : {}),
        ...(params.editedPricingLogic ? { pricingLogic: params.editedPricingLogic } : {}),
      })
      .where(eq(templateVersions.id, version.id));
  }

  await db
    .update(templateVersions)
    .set({ status: "superseded" })
    .where(and(eq(templateVersions.companyId, params.companyId), eq(templateVersions.status, "approved")));

  const approvedAt = new Date().toISOString();
  await db
    .update(templateVersions)
    .set({ status: "approved", approvedAt })
    .where(eq(templateVersions.id, version.id));

  await db
    .update(companies)
    .set({ activeTemplateVersionId: version.id })
    .where(eq(companies.id, params.companyId));

  const [updated] = await db.select().from(templateVersions).where(eq(templateVersions.id, version.id));
  return updated;
}

export async function rejectTemplateVersion(params: { companyId: string; templateVersionId: string }) {
  const db = await getDb();
  await db
    .update(templateVersions)
    .set({ status: "rejected" })
    .where(
      and(
        eq(templateVersions.id, params.templateVersionId),
        eq(templateVersions.companyId, params.companyId)
      )
    );
}
