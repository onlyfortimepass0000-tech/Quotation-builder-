"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { openPdf, type OpenedPdf, type RenderedPage } from "@/lib/pdf/rasterize-client";
import { cropRegionFromPngBase64 } from "@/lib/pdf/crop-client";
import { sampleKey } from "@/lib/storage/keys";
import type { AssetLocation, ExtractionResult } from "@/lib/ai/types";

/** Asset detection is best-effort and occasionally slow/flaky (a separate
 *  model call, measured 16-28s+ just on its own under normal load) — give
 *  up after this long rather than let it hold up analysis indefinitely.
 *  It runs IN PARALLEL with page reading, so this timeout rarely matters. */
const ASSET_DETECTION_TIMEOUT_MS = 40_000;

/** Pages read at the same time. Enough to be fast, few enough to stay
 *  inside the free NVIDIA keys' rate limits. */
const PAGE_CONCURRENCY = 4;
/** Each page gets this many tries (the server also retries rate limits). */
const PAGE_ATTEMPTS = 3;
const MAX_FILES = 10;
const MAX_PAGES_PER_FILE = 200;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Files bigger than this upload in parallel chunks. */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;

type Crops = { logoCropBase64?: string; signatureCropBase64?: string };

/** What's already been done for one selected file, so a retry after a
 *  failure (busy AI, dropped connection) only redoes what's missing. */
interface FileProgress {
  blobUrl?: string;
  pages: Array<ExtractionResult | undefined>;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Like res.json(), but a non-JSON error page (e.g. a platform 413/504)
 *  becomes a readable message instead of "Unexpected token <". */
async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const error =
      res.status === 413
        ? "That request was too large for the server."
        : res.status === 504
          ? "The server took too long to answer. Please try again."
          : `Server error (${res.status}). Please try again.`;
    return { error } as T & { error?: string };
  }
}

async function extractPage(companyId: string, page: RenderedPage): Promise<ExtractionResult> {
  let lastError = "the AI service didn't respond";
  for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`/api/companies/${companyId}/extract-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: page.jpegBase64,
          mimeType: "image/jpeg",
          pageIndex: page.pageIndex,
          knownText: page.textLayer ?? undefined,
        }),
      });
      const json = await readJson<{ extraction?: ExtractionResult }>(res);
      if (res.ok && json.extraction) return json.extraction;
      lastError = json.error ?? `server error ${res.status}`;
      // Bad request / AI not configured won't fix themselves on a retry.
      if (res.status === 400 || res.status === 503) break;
    } catch {
      lastError = "network connection lost";
    }
    if (attempt < PAGE_ATTEMPTS) await sleep(attempt * 3000);
  }
  // A digital page's text is already exact — only the layout note is
  // missing, so don't fail the whole analysis over it.
  if (page.textLayer) {
    return {
      rawText: page.textLayer,
      layoutHints: { description: `page ${page.pageIndex + 1}: (layout not available)` },
    };
  }
  throw new Error(lastError);
}

async function detectAndCropAssets(companyId: string, page: RenderedPage): Promise<Crops | null> {
  if (!page.png) return null;
  const png = page.png;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_DETECTION_TIMEOUT_MS);
  let detectRes: Response;
  try {
    detectRes = await fetch(`/api/companies/${companyId}/detect-assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: page.jpegBase64,
        mimeType: "image/jpeg",
        width: page.jpegWidth,
        height: page.jpegHeight,
      }),
      signal: controller.signal,
    });
  } catch {
    return null; // timed out or network error — proceed without it
  } finally {
    clearTimeout(timer);
  }
  if (!detectRes.ok) return null;

  const { assets } = (await detectRes.json()) as { assets: AssetLocation };
  // Boxes come back in JPEG pixels; the JPEG may have been scaled down to
  // fit the upload limit, so map them onto the full-size PNG.
  const sx = png.width / page.jpegWidth;
  const sy = png.height / page.jpegHeight;
  const toPng = (b: { x: number; y: number; width: number; height: number }) => ({
    x: b.x * sx,
    y: b.y * sy,
    width: b.width * sx,
    height: b.height * sy,
  });
  const result: Crops = {};
  if (assets.logo.present && assets.logo.box) {
    const crop = await cropRegionFromPngBase64(png.base64, toPng(assets.logo.box), png.width, png.height);
    if (crop) result.logoCropBase64 = crop;
  }
  if (assets.signature.present && assets.signature.box) {
    const crop = await cropRegionFromPngBase64(
      png.base64,
      toPng(assets.signature.box),
      png.width,
      png.height
    );
    if (crop) result.signatureCropBase64 = crop;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function describePages(indexes: number[]) {
  const nums = indexes.map((i) => i + 1);
  return nums.length === 1 ? `page ${nums[0]}` : `pages ${nums.join(", ")}`;
}

export default function UploadForm({
  companyId,
  hasApprovedTemplate,
}: {
  companyId: string;
  hasApprovedTemplate: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  // First-ever analysis has nothing to "preserve", so there's no real choice —
  // always attempt extraction then. Once a template is approved, default to
  // NOT touching branding/terms on a re-upload; the owner opts in explicitly.
  const [updateBranding, setUpdateBranding] = useState(!hasApprovedTemplate);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useRef(new Map<string, FileProgress>());
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    let ticker: ReturnType<typeof setInterval> | undefined;
    const opened: OpenedPdf[] = [];
    try {
      if (files.length > MAX_FILES) throw new Error(`Please upload at most ${MAX_FILES} PDFs at a time.`);
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`"${file.name}" is over ${MAX_FILE_BYTES / 1024 / 1024} MB. Please upload a smaller PDF.`);
        }
      }

      setStatus("Opening PDF…");
      const docs: Array<{ file: File; pdf: OpenedPdf; state: FileProgress }> = [];
      for (const file of files) {
        const pdf = await openPdf(file);
        opened.push(pdf);
        if (pdf.numPages > MAX_PAGES_PER_FILE) {
          throw new Error(`"${file.name}" has ${pdf.numPages} pages; the limit is ${MAX_PAGES_PER_FILE}.`);
        }
        const key = fileKey(file);
        let state = progress.current.get(key);
        if (!state || state.pages.length !== pdf.numPages) {
          state = { pages: new Array(pdf.numPages).fill(undefined) };
          progress.current.set(key, state);
        }
        docs.push({ file, pdf, state });
      }

      // 1. The PDFs themselves go straight to Blob storage from the browser,
      //    so their size never hits the server's request limit.
      const uploads = Promise.all(
        docs.map(async ({ file, state }) => {
          if (state.blobUrl) return;
          const blob = await upload(sampleKey(companyId, crypto.randomUUID(), file.name), file, {
            access: "public",
            handleUploadUrl: `/api/companies/${companyId}/upload-sample`,
            contentType: "application/pdf",
            multipart: file.size > MULTIPART_THRESHOLD_BYTES,
          });
          state.blobUrl = blob.url;
        })
      );
      // Don't surface as unhandled while pages are still being read.
      uploads.catch(() => {});

      // 2. Logo/signature detection on page 1, alongside page reading.
      const assetPromise: Promise<Crops | null> = updateBranding
        ? docs[0].pdf
            .renderPage(0, { withPng: true })
            .then((page) => detectAndCropAssets(companyId, page))
            .catch(() => null)
        : Promise.resolve(null);

      // 3. Read every page of every file, a few at a time.
      const tasks = docs.flatMap((doc, d) =>
        doc.state.pages.flatMap((done, p) => (done ? [] : [{ d, p }]))
      );
      const totalPages = docs.reduce((n, doc) => n + doc.pdf.numPages, 0);
      let finished = totalPages - tasks.length;
      const failed = new Map<number, number[]>();
      const reasons = new Set<string>();
      const showProgress = () =>
        setStatus(`Reading pages… ${finished} of ${totalPages} done`);
      showProgress();
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(PAGE_CONCURRENCY, tasks.length) }, async () => {
          while (next < tasks.length) {
            const { d, p } = tasks[next++];
            const doc = docs[d];
            try {
              const page = await doc.pdf.renderPage(p);
              doc.state.pages[p] = await extractPage(companyId, page);
            } catch (err) {
              failed.set(d, [...(failed.get(d) ?? []), p]);
              reasons.add(err instanceof Error ? err.message : String(err));
            }
            finished++;
            showProgress();
          }
        })
      );
      if (failed.size > 0) {
        const parts = [...failed.entries()].map(
          ([d, pages]) => `${describePages(pages.sort((a, b) => a - b))} of "${docs[d].file.name}"`
        );
        throw new Error(
          `Couldn't read ${parts.join("; ")} (${[...reasons].slice(0, 2).join("; ")}). Click Analyze again; pages already read won't be redone.`
        );
      }

      setStatus("Finishing upload…");
      try {
        await uploads;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "";
        throw new Error(`Uploading the PDF failed${reason ? ` (${reason})` : ""}. Click Analyze again to retry.`);
      }

      // 4. Learn the template from everything that was read.
      const startedAt = Date.now();
      setStatus("Learning the template…");
      ticker = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setStatus(`Learning the template… ${s}s (usually 15-60s)`);
      }, 1000);
      const res = await fetch(`/api/companies/${companyId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samples: docs.map(({ file, state }) => ({
            blobUrl: state.blobUrl,
            originalFilename: file.name,
            pages: state.pages,
          })),
          updateBranding,
        }),
      });
      const json = await readJson<{ templateVersion?: { id: string } }>(res);
      if (!res.ok || !json.templateVersion) {
        throw new Error(`${json.error ?? "Analysis failed"} Click Analyze again to retry.`);
      }
      const versionId = json.templateVersion.id;
      clearInterval(ticker);
      for (const { file } of docs) progress.current.delete(fileKey(file));

      // Attach whatever asset detection found, if anything — but never let
      // it delay getting the reviewer to the result they're waiting for.
      assetPromise
        .then((crops) => {
          if (!crops) return;
          return fetch(`/api/companies/${companyId}/template-versions/${versionId}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(crops),
          });
        })
        .catch(() => {});

      setStatus("Done — redirecting to review…");
      router.push(`/companies/${companyId}/review/${versionId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus(null);
    } finally {
      if (ticker) clearInterval(ticker);
      await Promise.all(opened.map((pdf) => pdf.destroy().catch(() => {})));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="file"
        accept="application/pdf"
        multiple
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        className="text-sm"
      />
      {files.length > 0 && (
        <p className="text-xs text-neutral-500">{files.length} file(s) selected</p>
      )}

      {hasApprovedTemplate ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateBranding}
            onChange={(e) => setUpdateBranding(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Also update logo, signature & terms from this upload
            <span className="block text-xs text-neutral-400">
              Off by default — leaves your current logo/signature/terms exactly as they are and
              only relearns the fields/layout. Turn this on if this new PDF has a different logo,
              signature, or terms & conditions you want picked up.
            </span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-neutral-400">
          First analysis — we&apos;ll also try to detect a logo and signature on this PDF
          automatically (you can always upload your own in Branding above instead).
        </p>
      )}

      <button
        type="submit"
        disabled={busy || files.length === 0}
        className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {busy ? "Analyzing…" : "Analyze"}
      </button>
      {status && <p className="text-xs text-neutral-500">{status}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
