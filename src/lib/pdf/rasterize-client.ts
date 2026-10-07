"use client";

import { isUsableTextLayer, textLayerToText, type TextLayerItem } from "@/lib/pdf/text-layer";

/**
 * Browser-side PDF page rendering using pdfjs-dist's browser build.
 * This deliberately runs in the user's browser (not a server function):
 * server-side rendering would need the native canvas addon (see
 * src/lib/pdf/rasterize.ts), and client-side rendering also keeps CPU-heavy
 * work and its duration off the Vercel function budget entirely.
 *
 * Pages are rendered one at a time on demand (see openPdf), so a long
 * document never holds every page image in memory at once.
 */

export interface RenderedPage {
  pageIndex: number;
  /** JPEG, base64 without data: prefix — what gets sent to the AI. */
  jpegBase64: string;
  jpegWidth: number;
  jpegHeight: number;
  /**
   * The page's own text, when the PDF has a usable text layer (digital PDF).
   * null for scanned pages, which need OCR.
   */
  textLayer: string | null;
  /** Lossless render at full scale, only when requested (logo/signature cropping). */
  png?: { base64: string; width: number; height: number };
}

export interface OpenedPdf {
  numPages: number;
  renderPage(pageIndex: number, opts?: { withPng?: boolean }): Promise<RenderedPage>;
  destroy(): Promise<void>;
}

// 1.5x is already above what the vision model uses internally (most VLMs
// downscale to ~1024-1536px longest side) — 2.0x was extra upload/encode
// time for no real OCR benefit.
const SCALE = 1.5;
/** Oversized pages (A3, drawings) are capped so they don't balloon the image. */
const MAX_SIDE_PX = 2200;
/**
 * Keep every page request well under Vercel's 4.5 MB function body limit
 * (base64 + JSON overhead included).
 */
const MAX_JPEG_BASE64_CHARS = 3_000_000;

export async function openPdf(file: File): Promise<OpenedPdf> {
  // The legacy build, not the default one: pdfjs v6's default build calls
  // brand-new JS built-ins (e.g. Map.prototype.getOrInsertComputed) that
  // current Chrome/Safari/Firefox releases don't ship yet, so every page
  // failed to render. The legacy build polyfills them.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      throw new Error(`"${file.name}" is password-protected. Remove the password and upload it again.`);
    }
    throw new Error(`"${file.name}" couldn't be opened as a PDF. It may be damaged.`);
  }

  return {
    numPages: pdf.numPages,
    async renderPage(pageIndex, opts) {
      const page = await pdf.getPage(pageIndex + 1);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter((i) => "str" in i) as TextLayerItem[];
        const text = textLayerToText(items);

        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(SCALE, MAX_SIDE_PX / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");
        // JPEG has no transparency: paint white first so transparent PDF
        // backgrounds don't come out black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;

        const jpeg = encodeJpegUnderLimit(canvas);
        const result: RenderedPage = {
          pageIndex,
          jpegBase64: jpeg.base64,
          jpegWidth: jpeg.width,
          jpegHeight: jpeg.height,
          textLayer: isUsableTextLayer(text) ? text : null,
        };
        if (opts?.withPng) {
          result.png = {
            base64: canvas.toDataURL("image/png").split(",")[1],
            width: canvas.width,
            height: canvas.height,
          };
        }
        // Free the bitmap now rather than whenever GC gets to it.
        canvas.width = 0;
        canvas.height = 0;
        return result;
      } finally {
        page.cleanup();
      }
    },
    async destroy() {
      await loadingTask.destroy();
    },
  };
}

/**
 * Normal pages come out at a few hundred KB. Very noisy scans can be much
 * bigger, so step quality and then size down until the page fits.
 */
function encodeJpegUnderLimit(source: HTMLCanvasElement): {
  base64: string;
  width: number;
  height: number;
} {
  let canvas = source;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const quality of [0.85, 0.7]) {
      const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      if (base64.length <= MAX_JPEG_BASE64_CHARS) {
        return { base64, width: canvas.width, height: canvas.height };
      }
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.round(canvas.width * 0.75));
    smaller.height = Math.max(1, Math.round(canvas.height * 0.75));
    smaller.getContext("2d")!.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
  }
  throw new Error("A page image is too large to process even after compressing it.");
}
