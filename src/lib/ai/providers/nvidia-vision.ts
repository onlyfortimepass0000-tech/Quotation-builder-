import type { ExtractionResult, ImageToTextProvider, PageImage } from "@/lib/ai/types";
import { nimChatCompletion } from "@/lib/ai/nvidia-nim";
import { EXTRACTION_PROMPT, LAYOUT_ONLY_PROMPT, parseExtractionReply } from "@/lib/ai/prompts";

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

  async extractFromImage(page: PageImage): Promise<ExtractionResult> {
    const layoutOnly = page.knownText !== undefined;
    const ask = (prompt: string, maxTokens: number, timeoutMs: number) =>
      nimChatCompletion({
        model: this.model,
        maxTokens,
        timeoutMs,
        maxAttempts: 2,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:${page.mimeType};base64,${page.base64}` },
              },
            ],
          },
        ],
      });

    if (layoutOnly) {
      // The text is already exact; the layout line is a nice-to-have for
      // Stage B (logo/signature slots). Never fail the page over it.
      try {
        const content = await ask(LAYOUT_ONLY_PROMPT, 120, 30_000);
        return parseExtractionReply(content, page.pageIndex, page.knownText);
      } catch {
        return {
          rawText: page.knownText!,
          layoutHints: { description: `page ${page.pageIndex + 1}: (layout not available)` },
        };
      }
    }

    // Full transcription. Image payloads measured 16-24s under normal load
    // for a single page; dense scanned pages need the extra token headroom
    // so the transcription isn't cut off mid-page.
    const content = await ask(EXTRACTION_PROMPT, 3000, 50_000);
    return parseExtractionReply(content, page.pageIndex);
  }
}

export const nvidiaVisionProvider = new NvidiaVisionProvider();
