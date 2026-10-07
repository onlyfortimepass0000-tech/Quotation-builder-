import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies, templateVersions, generatedQuotes } from "@/db/schema";
import { putFile, quoteKey } from "@/lib/storage";
import { renderQuotePdf } from "@/lib/pdf/render-quote";
import { fieldValueSchemaFor, effectiveAssets } from "@/lib/template-schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const db = await getDb();
  const quotes = await db
    .select()
    .from(generatedQuotes)
    .where(eq(generatedQuotes.companyId, companyId))
    .orderBy(desc(generatedQuotes.createdAt));
  return NextResponse.json({ quotes });
}

/**
 * The whole point of the approval gate: this handler makes zero AI calls.
 * It's a pure DB read + deterministic pdf-lib render, targeting <5s.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const db = await getDb();

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return NextResponse.json({ error: "company not found" }, { status: 404 });
  if (!company.activeTemplateVersionId) {
    return NextResponse.json(
      { error: "No approved template yet for this company" },
      { status: 400 }
    );
  }

  const [version] = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, company.activeTemplateVersionId));
  if (!version || version.status !== "approved") {
    return NextResponse.json({ error: "Active template is not in an approved state" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { fieldValues?: unknown } | null;
  const schema = fieldValueSchemaFor(version.variableFields);
  const parsed = schema.safeParse(body?.fieldValues);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const pdfBytes = await renderQuotePdf({
    layout: version.extractedLayout,
    fields: version.variableFields,
    values: parsed.data,
    pricingLogic: version.pricingLogic ?? undefined,
    assets: effectiveAssets(company, version.assets),
  });

  const quoteId = nanoid();
  const key = quoteKey(companyId, quoteId);
  const fileUrl = await putFile(key, pdfBytes, "application/pdf");

  await db.insert(generatedQuotes).values({
    id: quoteId,
    companyId,
    templateVersionId: version.id,
    fieldValues: parsed.data,
    pdfR2Key: fileUrl,
  });

  return NextResponse.json(
    { quote: { id: quoteId, downloadUrl: fileUrl } },
    { status: 201 }
  );
}
