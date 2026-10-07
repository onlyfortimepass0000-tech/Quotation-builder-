import type { LayoutSlot } from "@/lib/template-schema";

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Fixed pixel rectangle per anchor slot, on a 612x792 (US Letter) page.
 * This is OUR design, not AI-derived — Stage B only ever decides which
 * slots are present/static/variable, never coordinates. Every company's
 * generated quotes share this same clean grid; what differs between
 * companies is which slots are populated and with what.
 */
export const SLOT_RECTS: Record<LayoutSlot, Rect> = {
  logo: { x: 40, y: 720, width: 120, height: 40 },
  company_header: { x: 320, y: 715, width: 252, height: 55 },
  doc_title: { x: 40, y: 675, width: 532, height: 24 },
  quote_meta: { x: 40, y: 630, width: 250, height: 36 },
  client_info: { x: 320, y: 630, width: 252, height: 36 },
  items_table: { x: 40, y: 380, width: 532, height: 220 },
  totals: { x: 340, y: 340, width: 232, height: 30 },
  // Real-world terms & conditions are often several lines/bullet points, not
  // the single line our first synthetic fixture had — this used to be
  // 380x40, which overlapped the QR/stamp/signature row below it for
  // anything longer than ~2 short lines. Widened to full page width and
  // given the whole gap down to that row.
  terms: { x: 40, y: 110, width: 532, height: 210 },
  signature: { x: 420, y: 55, width: 152, height: 45 },
  stamp: { x: 220, y: 55, width: 100, height: 45 },
  qr: { x: 40, y: 55, width: 90, height: 55 },
  footer_note: { x: 40, y: 30, width: 532, height: 18 },
};

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
