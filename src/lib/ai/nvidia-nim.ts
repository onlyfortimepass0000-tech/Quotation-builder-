import { getEnv } from "@/db/client";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

let keyCursor = 0;

/**
 * All four supplied NVIDIA API keys belong to the same account (same
 * entitlements, same rate limits) — round-robin only buys headroom against
 * per-key rate limits, it is NOT a way to reach different providers.
 */
async function nextApiKey(): Promise<string> {
  const env = await getEnv();
  const keys = [
    env.NVIDIA_API_KEY_1,
    env.NVIDIA_API_KEY_2,
    env.NVIDIA_API_KEY_3,
    env.NVIDIA_API_KEY_4,
  ].filter((k): k is string => Boolean(k));
  if (keys.length === 0) {
    throw new Error("No NVIDIA_API_KEY_* configured");
  }
  const key = keys[keyCursor % keys.length];
  keyCursor++;
  return key;
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 = per-key rate limit on the free tier; a retry goes out on the next
// key in the pool, which usually clears it.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export async function nimChatCompletion(opts: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * gpt-oss models spend a large, variable amount of "reasoning" tokens
   * before emitting content — measured ~60s+ at default effort vs ~13s at
   * "low" for the same Stage B prompt, with no loss in JSON validity. Only
   * meaningful for reasoning models; harmless no-op otherwise.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /** Bypass the 4-key round-robin pool and use this exact key instead (e.g. a
   *  different NVIDIA account entitled for a different model). */
  apiKeyOverride?: string;
  /** Per-attempt timeout in ms — a single hung request must not eat the
   *  whole retry budget. Default 20s: measured a live outage where this
   *  endpoint didn't respond at all for 90s+, so waiting 45s x 3 attempts
   *  (the old default) meant 2-3 minutes before a caller saw anything. */
  timeoutMs?: number;
  /** Total attempts including the first try (each with its own timeoutMs). */
  maxAttempts?: number;
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 25_000;

  // Shared NVIDIA-hosted endpoints intermittently 503 ("Worker local total
  // request limit reached") or 504 (gateway timeout) under load — measured
  // directly, including a live 504 from openai/gpt-oss-20b. Retry both with
  // backoff instead of failing on a transient blip, but keep the total
  // budget bounded — a real outage doesn't resolve itself in the time it
  // takes to retry, so more attempts just means a longer silent wait.
  const maxAttempts = opts.maxAttempts ?? 2;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const apiKey = opts.apiKeyOverride ?? (await nextApiKey());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(NIM_BASE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 1600,
          temperature: opts.temperature ?? 0,
          ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        }),
        signal: controller.signal,
      });
    } catch {
      // A timeout is NOT retried: if a call already burned its whole budget,
      // a second identical call just doubles the wait. Only fast HTTP 5xx
      // responses (below) are worth retrying.
      throw new Error(`NVIDIA NIM ${opts.model} did not respond within ${Math.round(timeoutMs / 1000)}s`);
    } finally {
      clearTimeout(timer);
    }

    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      await sleep(attempt * (res.status === 429 ? 4000 : 2000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastError = new Error(
        `NVIDIA NIM ${opts.model} request failed (${res.status}): ${body.slice(0, 300)}`
      );
      break;
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (content === null || content === undefined) {
      throw new Error(
        `NVIDIA NIM ${opts.model} returned no content (likely truncated by max_tokens on a reasoning model — raise maxTokens)`
      );
    }
    return content;
  }
  throw lastError ?? new Error(`NVIDIA NIM ${opts.model} request failed after ${maxAttempts} attempts`);
}

/**
 * Reasoning models sometimes wrap JSON in prose or code fences despite
 * instructions. Extract the first balanced top-level {...} block instead of
 * trusting the model to emit bare JSON.
 */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in model output");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return JSON.parse(candidate);
      }
    }
  }
  throw new Error("Unbalanced JSON object in model output");
}
