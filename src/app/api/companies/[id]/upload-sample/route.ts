import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { samplePrefix } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

/**
 * Issues a short-lived token so the browser can upload a sample PDF directly
 * to Vercel Blob. Function request bodies are capped at 4.5 MB on Vercel, and
 * scanned quotations are routinely bigger than that, so the PDF never passes
 * through a function. The token only allows a PDF, under this company's
 * samples folder, up to MAX_SAMPLE_BYTES.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: companyId } = await context.params;
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "invalid request body" }, { status: 400 });

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(samplePrefix(companyId)) || !pathname.endsWith(".pdf")) {
          throw new Error("invalid upload path");
        }
        const db = await getDb();
        const [company] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId));
        if (!company) throw new Error("company not found");
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_SAMPLE_BYTES,
          addRandomSuffix: false,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload not allowed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
