import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { ExtractedLayout, VariableField, PricingLogic, TemplateAssets } from "@/lib/template-schema";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  activeTemplateVersionId: text("active_template_version_id"),
  // Manually-uploaded branding images (reliable path — always exactly what the
  // owner intended). New template versions default to these unless the owner
  // explicitly opts to extract fresh ones from a newly uploaded sample PDF.
  logoR2Key: text("logo_r2_key"),
  signatureR2Key: text("signature_r2_key"),
});

export const uploadedSamples = pgTable("uploaded_samples", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  r2Key: text("r2_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  uploadedAt: timestamp("uploaded_at", { mode: "string" }).notNull().defaultNow(),
  usedInAnalysisVersionId: text("used_in_analysis_version_id"),
});

export const templateVersions = pgTable("template_versions", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  versionNumber: integer("version_number").notNull(),
  basedOnVersionId: text("based_on_version_id"),
  extractedLayout: jsonb("extracted_layout").notNull().$type<ExtractedLayout>(),
  variableFields: jsonb("variable_fields").notNull().$type<VariableField[]>(),
  pricingLogic: jsonb("pricing_logic").$type<PricingLogic>(),
  assets: jsonb("assets").$type<TemplateAssets>(),
  // Stage A/B raw output kept for the review screen + debugging, not used at generation time.
  rawExtraction: jsonb("raw_extraction").$type<
    Array<{ sampleId: string; rawText: string; layoutHints?: unknown }>
  >(),
  status: text("status", {
    enum: ["pending_review", "approved", "superseded", "rejected"],
  })
    .notNull()
    .default("pending_review"),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { mode: "string" }),
});

export const generatedQuotes = pgTable("generated_quotes", {
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  templateVersionId: text("template_version_id")
    .notNull()
    .references(() => templateVersions.id),
  fieldValues: jsonb("field_values").notNull().$type<Record<string, unknown>>(),
  pdfR2Key: text("pdf_r2_key").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
});
