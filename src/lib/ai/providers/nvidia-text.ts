import type { ExtractionResult, TextAnalysisProvider } from "@/lib/ai/types";
import { nimChatCompletion, extractJsonObject } from "@/lib/ai/nvidia-nim";
import { STAGE_B_SYSTEM_PROMPT, buildStageBUserPrompt } from "@/lib/ai/prompts";
import { parseStageBOutput, MAX_VARIABLE_FIELDS, type StageBResult } from "@/lib/template-schema";

/**
 * openai/gpt-oss-20b on NVIDIA NIM — confirmed working against the supplied
 * account, and reliably follows JSON-only instructions when given enough
 * max_tokens headroom for its reasoning tokens.
 */
const MODEL = "openai/gpt-oss-20b";

/**
 * meta/llama-3.2-11b-vision-instruct (already used for Stage A) as an
 * emergency fallback for Stage B. Measured directly: when gpt-oss-20b had a
 * live outage on NVIDIA's side (90s+, zero response, even for a trivial
 * prompt), this model still answered the full Stage B prompt in ~39s. It's
 * not a reasoning model, so it doesn't follow the "collapse into one
 * line_items field" instruction as precisely — expect more/flatter fields
 * from it — but a usable, reviewable result beats a 3-minute hang that
 * fails anyway. The existing MAX_VARIABLE_FIELDS safety net below still
 * caps whatever it returns, and the reviewer can merge/remove fields same
 * as always.
 */
const FALLBACK_MODEL = "meta/llama-3.2-11b-vision-instruct";

export class NvidiaTextProvider implements TextAnalysisProvider {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  private model: string;
  private reasoningEffort: "low" | "medium" | "high";

  constructor(opts?: {
    id?: string;
    label?: string;
    model?: string;
    available?: boolean;
    reasoningEffort?: "low" | "medium" | "high";
  }) {
    this.id = opts?.id ?? "nvidia-text";
    this.label = opts?.label ?? `NVIDIA NIM — gpt-oss-20b (${MODEL})`;
    this.model = opts?.model ?? MODEL;
    this.available = opts?.available ?? true;
    // "low" measured ~5x faster than default with no loss in JSON validity —
    // see nvidia-nim.ts. Analysis is one-time but a 60s+ wait during a live
    // demo is still worth avoiding.
    this.reasoningEffort = opts?.reasoningEffort ?? "low";
  }

  async analyzeStructure(
    samples: ExtractionResult[],
    priorTemplate?: StageBResult
  ): Promise<StageBResult> {
    const messages = [
      { role: "system" as const, content: STAGE_B_SYSTEM_PROMPT },
      { role: "user" as const, content: buildStageBUserPrompt(samples, priorTemplate) },
    ];

    let raw: string;
    try {
      // Fail fast (not the default 45s x 3) so a genuine outage falls
      // through to the backup model in well under a minute instead of
      // burning 2-3 minutes of retries before the caller sees anything.
      // One retry, not the default three — measured live: a real NVIDIA-
      // side outage doesn't recover in the time it takes to notice it.
      raw = await nimChatCompletion({
        model: this.model,
        maxTokens: 3000,
        reasoningEffort: this.reasoningEffort,
        timeoutMs: 60_000,
        maxAttempts: 2,
        messages,
      });
    } catch (primaryErr) {
      try {
        // Measured directly: this model is up and answers the full Stage B
        // prompt correctly, but takes ~39s for a prompt this size under
        // normal load — NOT down, just not fast. Give it the time it
        // actually needs rather than aborting right before it would have
        // succeeded; a single attempt, since retrying an already-working-
        // but-slow call only adds more wait for no benefit.
        raw = await nimChatCompletion({
          model: FALLBACK_MODEL,
          maxTokens: 2500,
          timeoutMs: 60_000,
          maxAttempts: 1,
          messages,
        });
      } catch (fallbackErr) {
        const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Both text models failed or were too slow to answer right now (NVIDIA's hosted endpoint is under load). Please try again in a minute. (primary: ${primaryMsg}; fallback: ${fallbackMsg})`
        );
      }
    }

    const parsed = extractJsonObject(raw);
    const result = parseStageBOutput(parsed);

    // Safety net only — the prompt already targets ~3-4 fields by default,
    // this just guards against a runaway response. The reviewer can add
    // more manually afterward regardless (up to MAX_FIELDS in the UI).
    if (result.variableFields.length > MAX_VARIABLE_FIELDS) {
      result.variableFields = result.variableFields
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_VARIABLE_FIELDS);
    }
    return result;
  }
}

export const nvidiaTextProvider = new NvidiaTextProvider();
