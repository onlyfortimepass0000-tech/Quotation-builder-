"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rasterizePdfFileToPngPages } from "@/lib/pdf/rasterize-client";
import { cropRegionFromPngBase64, getPngDimensions } from "@/lib/pdf/crop-client";
import type { AssetLocation } from "@/lib/ai/types";

/** Asset detection is best-effort and occasionally slow/flaky (a separate
 *  model call, measured 16-28s+ just on its own under normal load) — give
 *  up after this long rather than let it hold up analysis indefinitely.
 *  It now runs IN PARALLEL with analysis (not before it), so this timeout
 *  rarely matters in practice — worst case is max(this, analysis time),
 *  not their sum, which is what pushed total time past 2 minutes before. */
const ASSET_DETECTION_TIMEOUT_MS = 40_000;

async function detectAndCropAssets(
  companyId: string,
  firstPage: string
): Promise<{ logoCropBase64?: string; signatureCropBase64?: string } | null> {
  const { width, height } = await getPngDimensions(firstPage);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_DETECTION_TIMEOUT_MS);
  let detectRes: Response;
  try {
    detectRes = await fetch(`/api/companies/${companyId}/detect-assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pngBase64: firstPage, width, height }),
      signal: controller.signal,
    });
  } catch {
    return null; // timed out or network error — proceed without it
  } finally {
    clearTimeout(timer);
  }
  if (!detectRes.ok) return null;

  const { assets } = (await detectRes.json()) as { assets: AssetLocation };
  const result: { logoCropBase64?: string; signatureCropBase64?: string } = {};
  if (assets.logo.present && assets.logo.box) {
    const crop = await cropRegionFromPngBase64(firstPage, assets.logo.box, width, height);
    if (crop) result.logoCropBase64 = crop;
  }
  if (assets.signature.present && assets.signature.box) {
    const crop = await cropRegionFromPngBase64(firstPage, assets.signature.box, width, height);
    if (crop) result.signatureCropBase64 = crop;
  }
  return Object.keys(result).length > 0 ? result : null;
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
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    let ticker: ReturnType<typeof setInterval> | undefined;
    try {
      setStatus("Rendering PDF pages in your browser…");
      const pngPagesPerFile: string[][] = [];
      for (const file of files) {
        pngPagesPerFile.push(await rasterizePdfFileToPngPages(file));
      }

      const form = new FormData();
      for (const file of files) form.append("file", file);
      form.append("pngPagesJson", JSON.stringify(pngPagesPerFile));
      form.append("updateBranding", String(updateBranding));

      // Asset detection (a separate, sometimes-slow model call) and the main
      // analysis (Stage A + B) are independent — run them concurrently
      // instead of blocking one on the other. If detection is still running
      // when analysis finishes, we don't wait on it further; the crop gets
      // attached in the background via a quick follow-up call instead of
      // holding up the redirect.
      setStatus("Reading your PDF and learning the template (usually 30-60s)…");
      const startedAt = Date.now();
      ticker = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setStatus(`Reading your PDF and learning the template… ${s}s (usually 30-60s)`);
      }, 1000);
      const firstPage = pngPagesPerFile[0]?.[0];
      const assetPromise =
        updateBranding && firstPage ? detectAndCropAssets(companyId, firstPage) : Promise.resolve(null);
      const analyzePromise = fetch(`/api/companies/${companyId}/analyze`, {
        method: "POST",
        body: form,
      });

      const res = await analyzePromise;
      const json = (await res.json()) as {
        error?: string;
        templateVersion?: { id: string };
      };
      if (!res.ok || !json.templateVersion) throw new Error(json.error ?? "Analysis failed");
      const versionId = json.templateVersion.id;
      clearInterval(ticker);

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
