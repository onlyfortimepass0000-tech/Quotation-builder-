"use client";

/**
 * Crops a sub-region out of a base64 PNG in the browser. Used to turn the
 * asset-locator model's approximate bounding box into an actual logo/
 * signature image file, entirely client-side (same reasoning as
 * rasterize-client.ts: no image manipulation happens on the server).
 *
 * The model's coordinates are never pixel-exact (see README.md) — measured
 * directly against a realistic fixture, the signature box came back over
 * 500px from the real signature, producing a crop of pure blank page. That
 * kind of miss can't be fixed with padding alone, so after cropping this
 * checks whether the result actually has *something* in it (not just
 * background) and returns null rather than a blank image when it doesn't.
 * Returning null here means resolveAssets() falls back to whatever was
 * already there — never worse than before, never a blank placeholder
 * masquerading as a real signature.
 */
export async function cropRegionFromPngBase64(
  pngBase64: string,
  box: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
  paddingRatio = 0.6
): Promise<string | null> {
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);

  const padX = box.width * paddingRatio;
  const padY = box.height * paddingRatio;
  const sx = Math.max(0, box.x - padX);
  const sy = Math.max(0, box.y - padY);
  const sw = Math.min(imageWidth - sx, box.width + padX * 2);
  const sh = Math.min(imageHeight - sy, box.height + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  if (looksBlank(ctx, canvas.width, canvas.height)) return null;
  return canvas.toDataURL("image/png").split(",")[1];
}

/**
 * Cheap "is there actually a graphic here" check: sample the four corners
 * as the presumed background color, then count how many pixels differ from
 * it by more than a small threshold. A real logo or signature mark will
 * cover a meaningful fraction of the crop; empty page background won't.
 */
function looksBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const bg = corners.map(([x, y]) => pixelAt(data, width, x, y));
  const bgAvg = [0, 1, 2].map((c) => bg.reduce((sum, p) => sum + p[c], 0) / bg.length);

  const step = Math.max(1, Math.floor((width * height) / 4000)); // sample, don't scan every pixel
  let different = 0;
  let sampled = 0;
  for (let i = 0; i < width * height; i += step) {
    const x = i % width;
    const y = Math.floor(i / width);
    const p = pixelAt(data, width, x, y);
    const diff = Math.abs(p[0] - bgAvg[0]) + Math.abs(p[1] - bgAvg[1]) + Math.abs(p[2] - bgAvg[2]);
    if (diff > 60) different++;
    sampled++;
  }
  const contentRatio = sampled > 0 ? different / sampled : 0;
  return contentRatio < 0.02;
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number] {
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

export async function getPngDimensions(pngBase64: string): Promise<{ width: number; height: number }> {
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image for cropping"));
    img.src = src;
  });
}
