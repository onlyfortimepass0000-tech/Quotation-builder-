"use client";

/**
 * Browser-side PDF -> PNG rasterization using pdfjs-dist's browser build.
 * This deliberately runs in the user's browser (not a server function):
 * server-side rendering would need the native canvas addon (see
 * src/lib/pdf/rasterize.ts), and client-side rendering also keeps CPU-heavy
 * work and its duration off the Vercel function budget entirely.
 *
 * Returns PNG data as base64 strings (no data: prefix), one per page.
 */
export async function rasterizePdfFileToPngPages(
  file: File,
  opts?: { scale?: number; maxPages?: number }
): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages, opts?.maxPages ?? 5);
  // 1.5x is already above what the vision model uses internally (most VLMs
  // downscale to ~1024-1536px longest side) — 2.0x was extra upload/encode
  // time for no real OCR benefit.
  const scale = opts?.scale ?? 1.5;

  const pages: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    pages.push(dataUrl.split(",")[1]);
  }
  return pages;
}
