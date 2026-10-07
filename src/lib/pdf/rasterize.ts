import { createCanvas } from "@napi-rs/canvas";

/**
 * DEV-ONLY. Renders each page of a PDF to a PNG (base64) using pdfjs-dist's
 * legacy Node build + @napi-rs/canvas — validated to work great under plain
 * `node`/`tsx` (see scripts/gen-fixture-pdf.ts and the CLAUDE.md notes).
 *
 * Do NOT call this from an API route. @napi-rs/canvas is a native N-API
 * addon that bloats serverless bundles and slows cold starts. The real
 * upload pipeline rasterizes client-side instead
 * (src/lib/pdf/rasterize-client.ts, using pdfjs-dist's browser build) and
 * uploads the PNGs alongside the PDF, so no server-side rasterization ever
 * needs to run on Vercel.
 */
export async function rasterizePdfToPngPages(
  pdfBytes: Uint8Array,
  opts?: { scale?: number; maxPages?: number }
): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, opts?.maxPages ?? 5);
  const scale = opts?.scale ?? 2.0;

  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    // @napi-rs/canvas's context isn't a DOM HTMLCanvasElement, so we pass
    // canvas:null and render through canvasContext instead (pdfjs's
    // documented backwards-compat path for non-DOM canvas implementations).
    await page.render({
      canvas: null,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const buffer = canvas.toBuffer("image/png");
    pages.push(buffer.toString("base64"));
  }
  return pages;
}
