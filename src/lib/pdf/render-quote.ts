import { PDFDocument, PDFFont, PDFImage, rgb, StandardFonts } from "pdf-lib";
import {
  LAYOUT_SLOTS,
  type ExtractedLayout,
  type LayoutSlot,
  type VariableField,
  type PricingLogic,
  type TemplateAssets,
} from "@/lib/template-schema";
import { SLOT_RECTS, PAGE_WIDTH, PAGE_HEIGHT, type Rect } from "@/lib/pdf/layout-grid";
import { getFile } from "@/lib/storage";

type FieldValues = Record<string, unknown>;

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Real-world text blocks (terms & conditions especially) vary wildly in
 * length. Rather than a fixed font size that either wastes space or
 * overflows into whatever's below, try progressively smaller sizes until
 * the wrapped text fits the rect's height; if even the minimum size
 * overflows, clip to what fits and mark it with "…" so it's visibly
 * truncated rather than silently overlapping other content.
 */
function fitText(
  lines: string[],
  font: PDFFont,
  maxWidth: number,
  maxHeight: number,
  maxSize: number,
  minSize = 6
): { lines: string[]; size: number; lineHeight: number; truncated: boolean } {
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lineHeight = size + 3;
    const wrapped = lines.flatMap((l) => wrapLines(l, font, size, maxWidth));
    const fitCount = Math.floor(maxHeight / lineHeight);
    if (wrapped.length <= fitCount) {
      return { lines: wrapped, size, lineHeight, truncated: false };
    }
    if (size === minSize) {
      const clipped = wrapped.slice(0, Math.max(fitCount, 1));
      if (clipped.length > 0) {
        clipped[clipped.length - 1] = clipped[clipped.length - 1].replace(/\s*$/, "") + "…";
      }
      return { lines: clipped, size, lineHeight, truncated: true };
    }
  }
  return { lines: [], size: minSize, lineHeight: minSize + 3, truncated: true };
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function embedAssetImage(doc: PDFDocument, r2Key: string | undefined): Promise<PDFImage | null> {
  if (!r2Key) return null;
  const file = await getFile(r2Key);
  if (!file) return null;
  const bytes = new Uint8Array(await new Response(file.body).arrayBuffer());
  try {
    if (file.contentType === "image/jpeg") return await doc.embedJpg(bytes);
    return await doc.embedPng(bytes);
  } catch {
    return null; // corrupt/unsupported image — fall back to placeholder rather than fail generation
  }
}

function drawImageContained(page: import("pdf-lib").PDFPage, image: PDFImage, rect: Rect) {
  const scale = Math.min(rect.width / image.width, rect.height / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + (rect.height - h) / 2,
    width: w,
    height: h,
  });
}

/**
 * Zero-AI, deterministic renderer: (approved layout + variable fields +
 * field values) -> PDF bytes. Every company's quotes share the same fixed
 * slot grid (src/lib/pdf/layout-grid.ts); what differs is which slots are
 * populated and with what static/variable content, per that company's
 * approved template. Logo/signature render as the real uploaded/extracted
 * image when `assets` provides one, else a clearly labeled placeholder box
 * (never a blank space, and never a guess).
 */
export async function renderQuotePdf(params: {
  layout: ExtractedLayout;
  fields: VariableField[];
  values: FieldValues;
  pricingLogic?: PricingLogic;
  assets?: TemplateAssets | null;
}): Promise<Uint8Array> {
  const { layout, fields, values, pricingLogic, assets } = params;
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const [logoImage, signatureImage] = await Promise.all([
    embedAssetImage(doc, assets?.logoR2Key),
    embedAssetImage(doc, assets?.signatureR2Key),
  ]);

  const slotByName = new Map(layout.slots.map((s) => [s.slot, s]));
  const fieldsBySlot = new Map<LayoutSlot, VariableField[]>();
  for (const f of fields) {
    const list = fieldsBySlot.get(f.slot) ?? [];
    list.push(f);
    fieldsBySlot.set(f.slot, list);
  }

  for (const slotName of LAYOUT_SLOTS) {
    const entry = slotByName.get(slotName);
    if (!entry || !entry.present) continue;
    const rect = SLOT_RECTS[slotName];
    const slotFields = fieldsBySlot.get(slotName) ?? [];

    if (slotName === "items_table") {
      renderItemsTable(page, rect, font, bold, entry.staticText, slotFields, values);
      continue;
    }
    if (slotName === "totals") {
      renderTotals(page, rect, font, bold, fields, values, pricingLogic);
      continue;
    }
    if (slotName === "logo" || slotName === "signature") {
      const image = slotName === "logo" ? logoImage : signatureImage;
      if (image) {
        drawImageContained(page, image, rect);
      } else {
        renderPlaceholderBox(page, rect, bold, `${slotName.toUpperCase()} NOT SET`);
      }
      continue;
    }
    if (["stamp", "qr"].includes(slotName)) {
      renderPlaceholderBox(page, rect, bold, slotName.toUpperCase());
      continue;
    }

    // Generic text slot: static text (if any) followed by variable field values.
    const textParts: string[] = [];
    if (entry.staticText) textParts.push(entry.staticText);
    for (const f of slotFields) {
      const v = values[f.key];
      if (v === undefined || v === null || v === "") continue;
      textParts.push(slotName === "doc_title" ? String(v) : `${f.label}: ${String(v)}`);
    }
    if (textParts.length === 0) continue;

    if (slotName === "doc_title") {
      const size = 16;
      const line = textParts.join(" ");
      const x = rect.x + (rect.width - bold.widthOfTextAtSize(line, size)) / 2;
      page.drawText(line, { x, y: rect.y + rect.height - size, size, font: bold });
      continue;
    }

    const useFont = slotName === "company_header" ? bold : font;
    const maxSize = 9.5;
    const fitted = fitText(textParts, useFont, rect.width, rect.height, maxSize);
    let y = rect.y + rect.height - fitted.size;
    for (const line of fitted.lines) {
      page.drawText(line, { x: rect.x, y, size: fitted.size, font: useFont });
      y -= fitted.lineHeight;
    }
  }

  return doc.save();
}

function renderPlaceholderBox(page: import("pdf-lib").PDFPage, rect: Rect, font: PDFFont, label: string) {
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: rgb(0.65, 0.65, 0.65),
    borderWidth: 1,
  });
  const size = 8;
  const w = font.widthOfTextAtSize(label, size);
  page.drawText(label, {
    x: rect.x + (rect.width - w) / 2,
    y: rect.y + rect.height / 2 - size / 2,
    size,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
}

function renderItemsTable(
  page: import("pdf-lib").PDFPage,
  rect: Rect,
  font: PDFFont,
  bold: PDFFont,
  staticText: string | undefined,
  slotFields: VariableField[],
  values: FieldValues
) {
  const lineItemsField = slotFields.find((f) => f.type === "line_items");
  let y = rect.y + rect.height - 10;

  if (!lineItemsField || !lineItemsField.columns) {
    // No structured table detected — just print whatever text fields target this slot.
    if (staticText) {
      page.drawText(staticText, { x: rect.x, y, size: 9, font });
      y -= 16;
    }
    for (const f of slotFields) {
      const v = values[f.key];
      if (v === undefined || v === "") continue;
      page.drawText(`${f.label}: ${String(v)}`, { x: rect.x, y, size: 9.5, font });
      y -= 16;
    }
    return;
  }

  const columns = lineItemsField.columns;
  const gap = 8;
  // Text columns (usually "Description") need much more room than number/currency
  // columns — equal division caused long descriptions to overlap the next
  // column, so weight by type instead.
  const weights = columns.map((c) => (c.type === "text" ? 3 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const usableWidth = rect.width - gap * (columns.length - 1);
  const colWidths = weights.map((w) => (w / totalWeight) * usableWidth);
  const colX: number[] = [];
  let cursor = rect.x;
  for (const w of colWidths) {
    colX.push(cursor);
    cursor += w + gap;
  }

  columns.forEach((c, i) => {
    page.drawText(c.label, { x: colX[i], y, size: 9.5, font: bold });
  });
  y -= 4;
  page.drawLine({ start: { x: rect.x, y }, end: { x: rect.x + rect.width, y }, thickness: 1 });
  y -= 16;

  const rows = (values[lineItemsField.key] as Array<Record<string, unknown>>) ?? [];
  for (const row of rows) {
    let rowHeight = 16;
    columns.forEach((c, i) => {
      const raw = row[c.key];
      const text = c.type === "currency" && typeof raw === "number" ? fmtCurrency(raw) : String(raw ?? "");
      const lines = wrapLines(text, font, 9, colWidths[i]);
      lines.forEach((line, li) => {
        page.drawText(line, { x: colX[i], y: y - li * 12, size: 9, font });
      });
      rowHeight = Math.max(rowHeight, lines.length * 12 + 4);
    });
    y -= rowHeight;
  }
}

/**
 * "qty_rate" (default): sum of qty × rate per row.
 * "flat_per_line": sum of whatever's already in the amount-like column, no
 *   multiplication — for businesses that key in a lump sum per line rather
 *   than a unit rate.
 * "custom": no auto-computed total — the reviewer adds an explicit field
 *   targeting the "totals" slot instead (renderTotals already prefers that
 *   over any computed value, see below).
 */
function computeLineItemsTotal(
  fields: VariableField[],
  values: FieldValues,
  presetId: string = "qty_rate"
): number | null {
  if (presetId === "custom") return null;

  const lineItemsField = fields.find((f) => f.type === "line_items");
  if (!lineItemsField || !lineItemsField.columns) return null;
  const rows = (values[lineItemsField.key] as Array<Record<string, unknown>>) ?? [];
  if (rows.length === 0) return null;

  if (presetId === "flat_per_line") {
    const amountCol = lineItemsField.columns.find((c) => /amount|total/i.test(c.key))?.key;
    if (!amountCol) return null;
    return rows.reduce((sum, row) => sum + (Number(row[amountCol]) || 0), 0);
  }

  // qty_rate (default)
  const qtyCol = lineItemsField.columns.find((c) => /qty|quantity/i.test(c.key))?.key;
  const rateCol = lineItemsField.columns.find((c) => /rate|price/i.test(c.key))?.key;
  if (!qtyCol || !rateCol) return null;
  return rows.reduce((sum, row) => sum + (Number(row[qtyCol]) || 0) * (Number(row[rateCol]) || 0), 0);
}

function renderTotals(
  page: import("pdf-lib").PDFPage,
  rect: Rect,
  font: PDFFont,
  bold: PDFFont,
  fields: VariableField[],
  values: FieldValues,
  pricingLogic?: PricingLogic
) {
  const explicitTotalField = fields.find((f) => f.slot === "totals" && f.type !== "line_items");
  let totalText: string;
  if (explicitTotalField && values[explicitTotalField.key] !== undefined && values[explicitTotalField.key] !== "") {
    const v = values[explicitTotalField.key];
    totalText = `${explicitTotalField.label}: ${
      typeof v === "number" ? fmtCurrency(v) : String(v)
    }`;
  } else {
    const computed = computeLineItemsTotal(fields, values, pricingLogic?.presetId);
    totalText = computed !== null ? `Total: ${fmtCurrency(computed)}` : "";
  }
  if (!totalText) return;
  const size = 11;
  const w = bold.widthOfTextAtSize(totalText, size);
  page.drawText(totalText, { x: rect.x + rect.width - w, y: rect.y + rect.height - size, size, font: bold });
}
