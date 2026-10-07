import { NextResponse } from "next/server";
import { getActiveAssetLocatorProvider } from "@/lib/ai/registry";
import { ProviderUnavailableError } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lightweight, single-call pre-flight: given one rasterized page (base64
 * PNG + its pixel dimensions), ask the asset-locator model for approximate
 * logo/signature bounding boxes. Returns coordinates only — nothing is
 * cropped or stored here. The client uses these to crop from the same
 * canvas it already rendered, then includes the crops in the main
 * /analyze submission. Never persists anything, so it's safe to call this
 * before the user has committed to "update logo/signature/terms".
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    pngBase64?: string;
    width?: number;
    height?: number;
  } | null;

  if (!body?.pngBase64 || !body.width || !body.height) {
    return NextResponse.json({ error: "pngBase64, width, height are required" }, { status: 400 });
  }

  try {
    const locator = await getActiveAssetLocatorProvider();
    const result = await locator.locateAssets(body.pngBase64, body.width, body.height);
    return NextResponse.json({ assets: result });
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Asset detection failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
