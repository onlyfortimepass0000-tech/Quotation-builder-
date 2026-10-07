import type { ExtractionResult, ImageToTextProvider, PageImage, TextAnalysisProvider } from "@/lib/ai/types";
import {
  EXTRACTION_PROMPT,
  LAYOUT_ONLY_PROMPT,
  STAGE_B_SYSTEM_PROMPT,
  buildStageBUserPrompt,
  parseExtractionReply,
} from "@/lib/ai/prompts";
import { extractJsonObject } from "@/lib/ai/nvidia-nim";
import { parseStageBOutput, MAX_VARIABLE_FIELDS, type StageBResult } from "@/lib/template-schema";

/**
 * TODO(access): Qwen was requested as a third candidate provider, but no
 * Qwen model is present in this NVIDIA NIM account's catalog (`/v1/models`
 * returns zero "qwen*" entries, and guessed model ids 404 at the path level —
 * a different error than Kimi's "not entitled", meaning it isn't reachable
 * on integrate.api.nvidia.com for this account at all, not just gated).
 *
 * This adapter is wired to a generic OpenAI-compatible chat/completions
 * endpoint (works with Alibaba DashScope's compatible-mode, a self-hosted
 * vLLM/NIM deployment of a Qwen checkpoint, or any other OpenAI-shaped Qwen
 * host) so it activates the moment real credentials are supplied — no code
 * change needed, just set these env vars:
 *   QWEN_BASE_URL   e.g. https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
 *   QWEN_API_KEY
 *   QWEN_MODEL      e.g. qwen2.5-72b-instruct
 */
function config() {
  const baseUrl = process.env.QWEN_BASE_URL;
  const apiKey = process.env.QWEN_API_KEY;
  const model = process.env.QWEN_MODEL ?? "qwen2.5-vl-72b-instruct";
  return { baseUrl, apiKey, model, available: Boolean(baseUrl && apiKey) };
}

async function qwenChatCompletion(messages: unknown[], maxTokens: number): Promise<string> {
  const { baseUrl, apiKey, model } = config();
  if (!baseUrl || !apiKey) {
    throw new Error("Qwen provider not configured: set QWEN_BASE_URL and QWEN_API_KEY");
  }
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Qwen request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Qwen returned no content");
  return content;
}

class QwenVisionProvider implements ImageToTextProvider {
  readonly id = "qwen-vision";
  readonly label = "Qwen VL (generic OpenAI-compatible endpoint) — not configured";
  get available() {
    return config().available;
  }

  async extractFromImage(page: PageImage): Promise<ExtractionResult> {
    const layoutOnly = page.knownText !== undefined;
    const content = await qwenChatCompletion(
      [
        {
          role: "user",
          content: [
            { type: "text", text: layoutOnly ? LAYOUT_ONLY_PROMPT : EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${page.mimeType};base64,${page.base64}` } },
          ],
        },
      ],
      layoutOnly ? 120 : 3000
    );
    return parseExtractionReply(content, page.pageIndex, page.knownText);
  }
}

class QwenTextProvider implements TextAnalysisProvider {
  readonly id = "qwen-text";
  readonly label = "Qwen (generic OpenAI-compatible endpoint) — not configured";
  get available() {
    return config().available;
  }

  async analyzeStructure(samples: ExtractionResult[], priorTemplate?: StageBResult): Promise<StageBResult> {
    const raw = await qwenChatCompletion(
      [
        { role: "system", content: STAGE_B_SYSTEM_PROMPT },
        { role: "user", content: buildStageBUserPrompt(samples, priorTemplate) },
      ],
      3000
    );
    const result = parseStageBOutput(extractJsonObject(raw));
    if (result.variableFields.length > MAX_VARIABLE_FIELDS) {
      result.variableFields = result.variableFields
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_VARIABLE_FIELDS);
    }
    return result;
  }
}

export const qwenVisionProvider = new QwenVisionProvider();
export const qwenTextProvider = new QwenTextProvider();
