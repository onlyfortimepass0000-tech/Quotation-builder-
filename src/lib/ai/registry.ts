import type { ImageToTextProvider, TextAnalysisProvider, AssetLocatorProvider } from "@/lib/ai/types";
import { ProviderUnavailableError } from "@/lib/ai/types";
import { nvidiaVisionProvider } from "@/lib/ai/providers/nvidia-vision";
import { nvidiaTextProvider } from "@/lib/ai/providers/nvidia-text";
import { kimiVisionProvider, kimiTextProvider } from "@/lib/ai/providers/kimi";
import { qwenVisionProvider, qwenTextProvider } from "@/lib/ai/providers/qwen";
import { mockVisionProvider, mockTextProvider } from "@/lib/ai/providers/mock";
import { nvidiaOmniAssetLocator } from "@/lib/ai/providers/nvidia-omni";
import { getEnv } from "@/db/client";

const IMAGE_TO_TEXT_PROVIDERS: Record<string, ImageToTextProvider> = {
  "nvidia-vision": nvidiaVisionProvider,
  "kimi-vision": kimiVisionProvider,
  "qwen-vision": qwenVisionProvider,
  mock: mockVisionProvider,
};

const TEXT_ANALYSIS_PROVIDERS: Record<string, TextAnalysisProvider> = {
  "nvidia-text": nvidiaTextProvider,
  "kimi-text": kimiTextProvider,
  "qwen-text": qwenTextProvider,
  mock: mockTextProvider,
};

const ASSET_LOCATOR_PROVIDERS: Record<string, AssetLocatorProvider> = {
  "nvidia-omni": nvidiaOmniAssetLocator,
};

export function listImageToTextProviders() {
  return Object.values(IMAGE_TO_TEXT_PROVIDERS).map(({ id, label, available }) => ({
    id,
    label,
    available,
  }));
}

export function listTextAnalysisProviders() {
  return Object.values(TEXT_ANALYSIS_PROVIDERS).map(({ id, label, available }) => ({
    id,
    label,
    available,
  }));
}

export async function getActiveImageToTextProvider(): Promise<ImageToTextProvider> {
  const env = await getEnv();
  const id = env.IMAGE_TO_TEXT_PROVIDER || "nvidia-vision";
  const provider = IMAGE_TO_TEXT_PROVIDERS[id];
  if (!provider) throw new Error(`Unknown IMAGE_TO_TEXT_PROVIDER "${id}"`);
  if (!provider.available) {
    throw new ProviderUnavailableError(id, "not entitled/configured — see provider file for setup TODO");
  }
  return provider;
}

export async function getActiveTextAnalysisProvider(): Promise<TextAnalysisProvider> {
  const env = await getEnv();
  const id = env.TEXT_ANALYSIS_PROVIDER || "nvidia-text";
  const provider = TEXT_ANALYSIS_PROVIDERS[id];
  if (!provider) throw new Error(`Unknown TEXT_ANALYSIS_PROVIDER "${id}"`);
  if (!provider.available) {
    throw new ProviderUnavailableError(id, "not entitled/configured — see provider file for setup TODO");
  }
  return provider;
}

export async function getActiveAssetLocatorProvider(): Promise<AssetLocatorProvider> {
  const env = await getEnv();
  const id = env.ASSET_LOCATOR_PROVIDER || "nvidia-omni";
  const provider = ASSET_LOCATOR_PROVIDERS[id];
  if (!provider) throw new Error(`Unknown ASSET_LOCATOR_PROVIDER "${id}"`);
  if (!provider.available) {
    throw new ProviderUnavailableError(id, "not entitled/configured — see provider file for setup TODO");
  }
  return provider;
}
