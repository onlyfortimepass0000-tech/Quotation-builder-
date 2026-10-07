import type { ExtractionResult, ImageToTextProvider, PageImage, TextAnalysisProvider } from "@/lib/ai/types";
import type { StageBResult } from "@/lib/template-schema";

/**
 * Deterministic, offline, zero-cost provider. Lets the whole
 * upload -> analyze -> review -> approve -> generate flow be demoed without
 * network access or API keys, and used as a network-failure fallback so a
 * flaky NVIDIA API call never blocks a live demo.
 */
class MockVisionProvider implements ImageToTextProvider {
  readonly id = "mock";
  readonly label = "Mock (offline, deterministic)";
  readonly available = true;

  async extractFromImage({ pageIndex, knownText }: PageImage): Promise<ExtractionResult> {
    return {
      rawText: knownText ?? [
        "Acme Fabricators Pvt Ltd",
        "221B Industrial Rd, Pune",
        "GSTIN: 27ABCDE1234F1Z5",
        "QUOTATION",
        "Quote #: Q-2026-0042",
        "Date: 2026-09-18",
        "Client: Bharat Textiles Ltd",
        "Description        Qty   Rate    Amount",
        "CNC Laser Cutting  120   85.00   10,200.00",
        "Powder Coating     120   35.00    4,200.00",
        "Total: Rs. 14,400.00",
        "Terms: 50% advance, balance on delivery. Validity 15 days.",
        "Authorized Signatory   [STAMP]   [QR]",
      ].join("\n"),
      layoutHints: {
        description: `page ${pageIndex + 1}: logo top-left, company info top-right, items table center, totals below table, terms lower-left, QR bottom-left, stamp bottom-center, signature bottom-right`,
      },
    };
  }
}

class MockTextProvider implements TextAnalysisProvider {
  readonly id = "mock";
  readonly label = "Mock (offline, deterministic)";
  readonly available = true;

  async analyzeStructure(
    _samples: ExtractionResult[],
    priorTemplate?: StageBResult
  ): Promise<StageBResult> {
    if (priorTemplate) return priorTemplate;
    const result: StageBResult = {
      layout: {
        pageSize: { width: 612, height: 792 },
        summary:
          "Logo top-left, company name/address/GSTIN top-right, 'QUOTATION' title centered, quote meta and client info left-aligned below, items table center, totals below table, terms lower-left, QR bottom-left, stamp bottom-center, signature bottom-right.",
        slots: [
          { slot: "logo", present: true, kind: "static" },
          {
            slot: "company_header",
            present: true,
            kind: "static",
            staticText: "Acme Fabricators Pvt Ltd\n221B Industrial Rd, Pune\nGSTIN: 27ABCDE1234F1Z5",
          },
          { slot: "doc_title", present: true, kind: "static", staticText: "QUOTATION" },
          { slot: "quote_meta", present: true, kind: "mixed", notes: "Quote # / date auto-generated" },
          { slot: "client_info", present: true, kind: "variable" },
          { slot: "items_table", present: true, kind: "variable" },
          { slot: "totals", present: true, kind: "variable", notes: "Computed from items_table" },
          {
            slot: "terms",
            present: true,
            kind: "static",
            staticText: "Terms: 50% advance, balance on delivery. Validity 15 days.",
          },
          { slot: "signature", present: true, kind: "static", staticText: "Authorized Signatory" },
          { slot: "stamp", present: true, kind: "static" },
          { slot: "qr", present: true, kind: "static" },
          { slot: "footer_note", present: false, kind: "static" },
        ],
      },
      variableFields: [
        { key: "clientName", label: "Client Name", type: "text", slot: "client_info", confidence: 0.95 },
        {
          key: "items",
          label: "Line Items",
          type: "line_items",
          slot: "items_table",
          confidence: 0.9,
          columns: [
            { key: "description", label: "Description", type: "text" },
            { key: "qty", label: "Qty", type: "number" },
            { key: "rate", label: "Rate", type: "currency" },
          ],
        },
        { key: "validityDays", label: "Validity (days)", type: "number", slot: "terms", confidence: 0.55 },
      ],
      pricingLogic: { detected: true, formula: "amount = qty * rate; total = sum(amounts)" },
    };
    return result;
  }
}

export const mockVisionProvider = new MockVisionProvider();
export const mockTextProvider = new MockTextProvider();
