/**
 * Turns a PDF page's text layer (pdfjs getTextContent items) back into
 * readable lines. Digital quotations (exported from Word, Excel, Tally,
 * Zoho, ...) carry their exact text, so reading it directly is both faster
 * and more accurate than OCR-ing a picture of the page. Pure functions, no
 * DOM: shared by the browser upload flow and tests.
 */

export interface TextLayerItem {
  str: string;
  /** pdfjs transform matrix [a, b, c, d, e, f]; e/f = x/y in PDF space (y grows upward). */
  transform: number[];
  width: number;
  height: number;
}

interface Placed {
  str: string;
  x: number;
  y: number;
  right: number;
  size: number;
}

export function textLayerToText(items: TextLayerItem[]): string {
  const placed: Placed[] = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const [, , c, d, e, f] = item.transform;
    const size = item.height || Math.hypot(c, d) || 10;
    placed.push({ str: item.str, x: e, y: f, right: e + item.width, size });
  }
  if (placed.length === 0) return "";

  // Top of the page first, then left to right.
  placed.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Placed[][] = [];
  for (const p of placed) {
    const line = lines[lines.length - 1];
    // Same baseline (within half a line height) = same visual line, so table
    // cells that pdfjs emits out of order still land on one row.
    if (line && Math.abs(line[0].y - p.y) <= Math.max(2, Math.min(line[0].size, p.size) * 0.5)) {
      line.push(p);
    } else {
      lines.push([p]);
    }
  }

  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let out = line[0].str;
      for (let i = 1; i < line.length; i++) {
        const prev = line[i - 1];
        const cur = line[i];
        const gap = cur.x - prev.right;
        const size = Math.min(prev.size, cur.size);
        // A wide gap is a column break (items table): keep it visible so the
        // text model can still tell the columns apart.
        if (gap > size * 1.5) out += "   ";
        else if (gap > size * 0.15 && !out.endsWith(" ") && !cur.str.startsWith(" ")) out += " ";
        out += cur.str;
      }
      return out.trimEnd();
    })
    .join("\n");
}

/**
 * Below this many letters/digits a page is treated as scanned (or as an
 * image with a stray text overlay) and goes through full OCR instead. A real
 * quotation page has far more text than this.
 */
const MIN_TEXT_CHARS = 80;

/**
 * Whether a page's text layer is trustworthy enough to skip OCR. Rejects
 * near-empty layers (scans) and garbled ones (PDFs with broken font
 * encodings, which extract as replacement characters or control codes).
 */
export function isUsableTextLayer(text: string): boolean {
  const meaningful = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (meaningful < MIN_TEXT_CHARS) return false;
  let nonSpace = 0;
  let garbage = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    nonSpace++;
    if (isGarbageChar(ch.codePointAt(0)!)) garbage++;
  }
  return garbage / Math.max(1, nonSpace) < 0.05;
}

/** Replacement char, control codes, or private-use glyphs (unmapped fonts). */
function isGarbageChar(code: number): boolean {
  return code === 0xfffd || code < 0x20 || (code >= 0xe000 && code <= 0xf8ff);
}
