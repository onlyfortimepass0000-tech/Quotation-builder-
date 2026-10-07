import type { ExtractionResult, ImageToTextProvider } from "@/lib/ai/types";
import { nimChatCompletion } from "@/lib/ai/nvidia-nim";
import { EXTRACTION_PROMPT } from "@/lib/ai/prompts";

/**
 * meta/llama-3.2-11b-vision-instruct on NVIDIA NIM (integrate.api.nvidia.com) —
 * confirmed working against the supplied account. Swap MODEL to the 90b
 * variant if higher table-reading accuracy is needed; analysis is one-time
 * so accuracy matters more than latency/cost here.
 */
const MODEL = "meta/llama-3.2-11b-vision-instruct";

export class NvidiaVisionProvider implements ImageToTextProvider {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  private model: string;

  constructor(opts?: { id?: string; label?: string; model?: string; available?: boolean }) {
    this.id = opts?.id ?? "nvidia-vision";
    this.label = opts?.label ?? `NVIDIA NIM — Llama 3.2 Vision (${MODEL})`;
    this.model = opts?.model ?? MODEL;
    this.available = opts?.available ?? true;
  }

  async extractFromImage(pngBase64: string, pageIndex: number): Promise<ExtractionResult> {
    const content = await nimChatCompletion({
      model: this.model,
      maxTokens: 2000,
      // Image payloads genuinely take longer than the text-only default
      // budget assumes — measured 16-24s under normal load for a single
      // page, right at the edge of (and sometimes past) a 25s timeout.
      // Give it real headroom instead of false-timing-out a call that was
      // about to succeed.
      timeoutMs: 40_000,
      maxAttempts: 2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${pngBase64}` },
            },
          ],
        },
      ],
    });

    const layoutMarker = content.lastIndexOf("LAYOUT:");
    const rawText = (layoutMarker === -1 ? content : content.slice(0, layoutMarker)).trim();
    const description =
      layoutMarker === -1
        ? "(no layout description returned)"
        : content.slice(layoutMarker + "LAYOUT:".length).trim();

    return {
      rawText,
      layoutHints: { description: `page ${pageIndex + 1}: ${description}` },
    };
  }
}

export const nvidiaVisionProvider = new NvidiaVisionProvider();
