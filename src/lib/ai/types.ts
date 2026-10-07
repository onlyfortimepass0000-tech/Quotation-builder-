import type { StageBResult } from "@/lib/template-schema";

export interface ExtractionResult {
  rawText: string;
  layoutHints: {
    /** Free-text description of what the vision model saw spatially. */
    description: string;
  };
}

/** One rendered page, as sent from the browser to /extract-page. */
export interface PageImage {
  /** base64 image data, no data: prefix */
  base64: string;
  mimeType: "image/jpeg" | "image/png";
  pageIndex: number;
  /**
   * Exact text read from the PDF's own text layer (digital PDFs). When set,
   * the provider only needs to describe the layout, not transcribe — faster,
   * and the text is exact instead of OCR'd.
   */
  knownText?: string;
}

export interface ImageToTextProvider {
  readonly id: string;
  readonly label: string;
  /** true if this adapter is actually callable right now (has credentials / entitlement). */
  readonly available: boolean;
  extractFromImage(page: PageImage): Promise<ExtractionResult>;
}

export interface TextAnalysisProvider {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  analyzeStructure(
    samples: ExtractionResult[],
    priorTemplate?: StageBResult
  ): Promise<StageBResult>;
}

/** Pixel box, (0,0) at top-left of the source image, x/y/width/height in px. */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedAsset {
  present: boolean;
  box?: PixelBox;
  /** 0-1: how confident the model is that `box` actually bounds the element. */
  confidence: number;
}

export interface AssetLocation {
  logo: DetectedAsset;
  signature: DetectedAsset;
}

/**
 * A model built for spatial grounding (unlike the general Stage A vision
 * model, which measurably cannot return usable bounding boxes — see
 * README.md). Used only to get an approximate region to crop; the crop is
 * always padded generously since the coordinates are best-effort, never
 * pixel-exact.
 */
export interface AssetLocatorProvider {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  locateAssets(
    imageBase64: string,
    mimeType: PageImage["mimeType"],
    imageWidth: number,
    imageHeight: number
  ): Promise<AssetLocation>;
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string, reason: string) {
    super(`AI provider "${providerId}" is not available: ${reason}`);
    this.name = "ProviderUnavailableError";
  }
}
