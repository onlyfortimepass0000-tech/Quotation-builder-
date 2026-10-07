import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveImageToTextProvider } from "@/lib/ai/registry";
import { ProviderUnavailableError } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// The browser keeps each page well under Vercel's 4.5 MB body limit; this
// is just a guard against anything unexpected.
const MAX_IMAGE_BASE64_CHARS = 4_000_000;

const bodySchema = z.object({
  imageBase64: z.string().min(1).max(MAX_IMAGE_BASE64_CHARS),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  pageIndex: z.number().int().min(0),
  knownText: z.string().max(200_000).optional(),
});

/**
 * Stage A for ONE page. The browser renders every page of every uploaded
 * PDF and calls this once per page (a few in parallel), so a document of
 * any length is read in full without one request having to carry, or wait
 * on, all of it. Digital PDFs also send the page's exact text layer as
 * `knownText`, so the model only has to describe the layout.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "imageBase64, mimeType and pageIndex are required" }, { status: 400 });
  }
  const { imageBase64, mimeType, pageIndex, knownText } = parsed.data;

  try {
    const provider = await getActiveImageToTextProvider();
    const extraction = await provider.extractFromImage({
      base64: imageBase64,
      mimeType,
      pageIndex,
      knownText,
    });
    return NextResponse.json({ extraction });
  } catch (err) {
    if (err instanceof ProviderUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Page extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
