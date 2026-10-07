import { NvidiaVisionProvider } from "@/lib/ai/providers/nvidia-vision";
import { NvidiaTextProvider } from "@/lib/ai/providers/nvidia-text";

/**
 * moonshotai/kimi-k2.6 is listed in this NVIDIA NIM account's model catalog
 * and IS natively multimodal (vision + text), so structurally it can serve
 * both pipeline stages through the same integrate.api.nvidia.com adapter
 * used for the nvidia-vision/nvidia-text providers.
 *
 * TODO(access): as of the last connectivity check, calling this model on the
 * supplied account returns `404 Not Found for account <id>` — the model is
 * catalogued but not entitled/deployed for this account yet. Request access
 * at https://build.nvidia.com/moonshotai/kimi-k3 (or the k2.6 page), or swap
 * the model id below once entitlement is granted. No code change needed
 * beyond flipping `available` to true — the adapter itself is real, not a
 * mock.
 */
const MODEL = "moonshotai/kimi-k2.6";
const AVAILABLE = false;

export const kimiVisionProvider = new NvidiaVisionProvider({
  id: "kimi-vision",
  label: `Kimi K2.6 via NVIDIA NIM (${MODEL}) — not entitled on this account`,
  model: MODEL,
  available: AVAILABLE,
});

export const kimiTextProvider = new NvidiaTextProvider({
  id: "kimi-text",
  label: `Kimi K2.6 via NVIDIA NIM (${MODEL}) — not entitled on this account`,
  model: MODEL,
  available: AVAILABLE,
});
