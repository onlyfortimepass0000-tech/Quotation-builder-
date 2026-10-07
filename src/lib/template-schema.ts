import { z } from "zod";

/**
 * Fixed set of anchor slots a quotation layout can use. Stage B (structural
 * analysis) assigns content to these slots — it never returns pixel
 * coordinates. The PDF renderer owns the actual rectangle for each slot, so
 * generation stays a deterministic function of (slot assignments + field
 * values) with no AI call involved.
 */
export const LAYOUT_SLOTS = [
  "logo",
  "company_header", // company name / address / tax id, usually top-right
  "doc_title", // "QUOTATION" / "ESTIMATE" heading
  "quote_meta", // quote #, date, validity
  "client_info", // who the quote is addressed to
  "items_table", // the line-items table
  "totals", // subtotal/tax/total block
  "terms", // boilerplate terms & conditions
  "signature",
  "stamp",
  "qr",
  "footer_note",
] as const;

export type LayoutSlot = (typeof LAYOUT_SLOTS)[number];

export const SLOT_LABELS: Record<LayoutSlot, string> = {
  logo: "Logo",
  company_header: "Company name & address block",
  doc_title: "Document title",
  quote_meta: "Quote number / date / validity",
  client_info: "Client / recipient info",
  items_table: "Line items table",
  totals: "Totals block",
  terms: "Terms & conditions",
  signature: "Signature block",
  stamp: "Stamp block",
  qr: "QR code",
  footer_note: "Footer note",
};

export const layoutSlotEntrySchema = z.object({
  slot: z.enum(LAYOUT_SLOTS),
  present: z.boolean(),
  kind: z.enum(["static", "variable", "mixed"]),
  // For static/mixed slots: the fixed text this company always uses here
  // (boilerplate terms, company address, etc). Omitted for pure-variable slots.
  staticText: z.string().optional(),
  notes: z.string().optional(),
});
export type LayoutSlotEntry = z.infer<typeof layoutSlotEntrySchema>;

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "line_items",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const lineItemColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "currency"]),
});
export type LineItemColumn = z.infer<typeof lineItemColumnSchema>;

export const variableFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  slot: z.enum(LAYOUT_SLOTS),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
  // Only present when type === "line_items"
  columns: z.array(lineItemColumnSchema).optional(),
});
export type VariableField = z.infer<typeof variableFieldSchema>;

/**
 * The AI still targets a minimal 3-4 field set by default (see
 * STAGE_B_SYSTEM_PROMPT) — this is a ceiling for what a human reviewer can
 * grow it to afterward via "+ Add field" on the review screen, not a target.
 */
export const MAX_VARIABLE_FIELDS = 8;

/**
 * Small fixed catalog of pricing formulas an owner can pick between, rather
 * than trying to parse/execute an arbitrary formula. "custom" means no
 * auto-computed total — the owner adds their own manual "Total" field
 * (already supported: renderTotals() prefers an explicit field over the
 * computed ones) instead of the renderer guessing at their math.
 */
export const PRICING_PRESETS = [
  {
    id: "qty_rate",
    label: "Quantity × Rate",
    description: "Each line's amount is quantity × rate; total is the sum of line amounts.",
  },
  {
    id: "flat_per_line",
    label: "Flat amount per line",
    description: "Each line has its own amount entered directly (no qty × rate multiplication); total is the sum.",
  },
  {
    id: "custom",
    label: "Custom / manual total",
    description: "No formula applied automatically — add a manual \"Total\" field and type it in per quote.",
  },
] as const;
export type PricingPresetId = (typeof PRICING_PRESETS)[number]["id"];
export const PRICING_PRESET_IDS = PRICING_PRESETS.map((p) => p.id) as [PricingPresetId, ...PricingPresetId[]];

export const pricingLogicSchema = z.object({
  detected: z.boolean(),
  presetId: z.enum(PRICING_PRESET_IDS).optional(),
  description: z.string().optional(),
  // e.g. "amount = qty * rate", "total = sum(line amounts)" — informational,
  // shown to the reviewer; the renderer keys off presetId, not this text.
  formula: z.string().optional(),
});
export type PricingLogic = z.infer<typeof pricingLogicSchema>;

export const templateAssetsSchema = z.object({
  logoR2Key: z.string().optional(),
  stampR2Key: z.string().optional(),
  signatureR2Key: z.string().optional(),
});
export type TemplateAssets = z.infer<typeof templateAssetsSchema>;

/**
 * A manually-uploaded company asset is a deliberate, always-correct choice
 * by the owner — it wins over whatever a template version's asset-locator
 * extraction found, every time, no matter how recent the extraction. This
 * is what makes "upload the right one in Branding" a real fix for a bad
 * auto-crop rather than something that gets silently re-overridden on the
 * next re-analysis. Extraction only fills in when the owner hasn't
 * manually set that asset at all.
 */
export function effectiveAssets(
  company: { logoR2Key: string | null; signatureR2Key: string | null },
  versionAssets: TemplateAssets | null
): TemplateAssets | null {
  const logoR2Key = company.logoR2Key ?? versionAssets?.logoR2Key;
  const signatureR2Key = company.signatureR2Key ?? versionAssets?.signatureR2Key;
  const stampR2Key = versionAssets?.stampR2Key;
  if (!logoR2Key && !signatureR2Key && !stampR2Key) return null;
  return {
    ...(logoR2Key ? { logoR2Key } : {}),
    ...(signatureR2Key ? { signatureR2Key } : {}),
    ...(stampR2Key ? { stampR2Key } : {}),
  };
}

export const extractedLayoutSchema = z.object({
  pageSize: z.object({ width: z.number(), height: z.number() }).default({
    width: 612,
    height: 792,
  }),
  slots: z.array(layoutSlotEntrySchema),
  summary: z.string().optional(), // human-readable one-paragraph description
});
export type ExtractedLayout = z.infer<typeof extractedLayoutSchema>;

export const stageBResultSchema = z.object({
  layout: extractedLayoutSchema,
  variableFields: z.array(variableFieldSchema).max(MAX_VARIABLE_FIELDS),
  pricingLogic: pricingLogicSchema.optional(),
});
export type StageBResult = z.infer<typeof stageBResultSchema>;

/**
 * The model is asked for a COMPACT answer (only the slots that exist, no
 * notes/summary/pageSize) because output tokens are the dominant latency
 * cost — measured ~28 tok/s on the hosted endpoint, so the old verbose
 * shape (~1070 tokens) took ~38s. This expands compact output back into the
 * full stored shape, and still accepts the old verbose shape.
 */
export function parseStageBOutput(raw: unknown): StageBResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const layoutIn = (obj.layout ?? {}) as Record<string, unknown>;
  const listed = (Array.isArray(layoutIn.slots) ? layoutIn.slots : Array.isArray(obj.slots) ? obj.slots : []) as Array<
    Record<string, unknown>
  >;

  const bySlot = new Map<string, LayoutSlotEntry>();
  for (const s of listed) {
    if (!LAYOUT_SLOTS.includes(s.slot as LayoutSlot)) continue;
    const kind = ["static", "variable", "mixed"].includes(s.kind as string)
      ? (s.kind as LayoutSlotEntry["kind"])
      : "static";
    bySlot.set(s.slot as string, {
      slot: s.slot as LayoutSlot,
      present: s.present === false ? false : true,
      kind,
      ...(typeof s.staticText === "string" && s.staticText.trim() ? { staticText: s.staticText } : {}),
      ...(typeof s.notes === "string" && s.notes.trim() ? { notes: s.notes } : {}),
    });
  }
  const slots: LayoutSlotEntry[] = LAYOUT_SLOTS.map(
    (slot) => bySlot.get(slot) ?? { slot, present: false, kind: "static" as const }
  );
  const presentLabels = slots.filter((s) => s.present).map((s) => SLOT_LABELS[s.slot].toLowerCase());

  return stageBResultSchema.parse({
    layout: {
      pageSize: layoutIn.pageSize ?? { width: 612, height: 792 },
      slots,
      summary:
        typeof layoutIn.summary === "string" && layoutIn.summary
          ? layoutIn.summary
          : `Detected: ${presentLabels.join(", ")}.`,
    },
    variableFields: obj.variableFields ?? [],
    pricingLogic: obj.pricingLogic,
  });
}

export function fieldValueSchemaFor(fields: VariableField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    switch (f.type) {
      case "number":
        shape[f.key] = z.coerce.number();
        break;
      case "currency":
        shape[f.key] = z.coerce.number();
        break;
      case "date":
        shape[f.key] = z.string().min(1);
        break;
      case "line_items":
        shape[f.key] = z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1);
        break;
      default:
        shape[f.key] = z.string().min(1);
    }
  }
  return z.object(shape);
}
