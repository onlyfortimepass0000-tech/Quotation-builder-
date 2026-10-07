import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, templateVersions } from "@/db/schema";
import { renderQuotePdf } from "@/lib/pdf/render-quote";
import { placeholderFieldValues } from "@/lib/pdf/placeholder-values";
import { effectiveAssets } from "@/lib/template-schema";

export const dynamic = "force-dynamic";

/**
 * Renders the template version with placeholder values, on demand, never
 * stored — purely for the review screen's "what will this actually look
 * like" preview. Same zero-AI renderQuotePdf() the real generate flow uses,
 * so the preview is never out of sync with what generation actually
 * produces.
 */
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
  if (!version) return new Response("Not found", { status: 404 });
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return new Response("Not found", { status: 404 });

  const pdfBytes = await renderQuotePdf({
    layout: version.extractedLayout,
    fields: version.variableFields,
    values: placeholderFieldValues(version.variableFields),
    pricingLogic: version.pricingLogic ?? undefined,
    assets: effectiveAssets(company, version.assets),
  });

  return new Response(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
