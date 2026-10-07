import { z } from "zod";
import type { AssetLocation, AssetLocatorProvider, PageImage } from "@/lib/ai/types";
import { nimChatCompletion, extractJsonObject } from "@/lib/ai/nvidia-nim";
import { getEnv } from "@/db/client";

/**
 * nvidia/nemotron-3-nano-omni-30b-a3b-reasoning — a separate NVIDIA account
 * entitlement (own API key) from the other four keys. Unlike the general
 * Stage A vision model (meta/llama-3.2-11b-vision-instruct), which measurably
 * cannot ground objects (asked for a box, got back literal image corners —
 * see README.md), this model gives genuinely spatially-aware — though still
 * imprecise — coordinates. Boxes are treated as approximate and always
 * cropped with generous padding (see pipeline/crop-asset.ts client helper),
 * never trusted pixel-exact.
 */
const MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

const detectedAssetSchema = z.object({
  present: z.boolean(),
  confidence: z.number().min(0).max(1).default(0.5),
  box: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

const assetLocationSchema = z.object({
  logo: detectedAssetSchema,
  signature: detectedAssetSchema,
});

function buildPrompt(width: number, height: number): string {
  return `This is page 1 of a business quotation/invoice document, rendered as an image ${width}x${height} pixels, (0,0) at the top-left corner, x increasing right, y increasing down.

Find two things:
1. LOGO: a graphic/image brand mark (not plain body text) — usually near the top of the page, often top-left or top-right, near the company name.
2. SIGNATURE: where an authorized person signs — could be an actual handwritten signature, a "Signature:" / "Authorized Signatory" label with a line or box, or a blank ruled line reserved for one. Usually near the bottom of the page.

Either may be genuinely absent — do not invent one that isn't there.

Output ONLY this JSON, no commentary, no markdown fences:
{
  "logo": { "present": true|false, "confidence": 0.0-1.0, "box": { "x": 0, "y": 0, "width": 0, "height": 0 } },
  "signature": { "present": true|false, "confidence": 0.0-1.0, "box": { "x": 0, "y": 0, "width": 0, "height": 0 } }
}
Omit "box" entirely when present is false. Your coordinates will never be pixel-perfect, so err toward a box generous enough to fully contain the element rather than a tight one that might clip it.`;
}

class NvidiaOmniAssetLocator implements AssetLocatorProvider {
  readonly id = "nvidia-omni";
  readonly label = `NVIDIA NIM — Nemotron 3 Nano Omni (${MODEL})`;
  readonly available = true;

  async locateAssets(
    imageBase64: string,
    mimeType: PageImage["mimeType"],
    imageWidth: number,
    imageHeight: number
  ): Promise<AssetLocation> {
    const env = await getEnv();
    const apiKeyOverride = env.NVIDIA_API_KEY_OMNI;
    if (!apiKeyOverride) {
      throw new Error("NVIDIA_API_KEY_OMNI not configured");
    }

    const raw = await nimChatCompletion({
      model: MODEL,
      apiKeyOverride,
      maxTokens: 1000,
      // Measured 16-28s+ for this exact prompt+image under normal load, and
      // the caller (upload-form.tsx) hard-aborts the whole request at 40s
      // client-side — keep the server's own retry budget inside that
      // window instead of silently exceeding it.
      timeoutMs: 18_000,
      maxAttempts: 3,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(imageWidth, imageHeight) },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
    });

    const parsed = assetLocationSchema.parse(extractJsonObject(raw));
    return parsed;
  }
}

export const nvidiaOmniAssetLocator = new NvidiaOmniAssetLocator();
