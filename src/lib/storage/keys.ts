/**
 * Blob pathnames shared by the server and the browser. Kept free of any
 * Blob SDK import so client components can use it: sample PDFs are uploaded
 * straight from the browser (they can be far larger than Vercel's 4.5 MB
 * request-body limit), and the server only ever sees their URL.
 */
export function samplePrefix(companyId: string) {
  return `companies/${companyId}/samples/`;
}

export function sampleKey(companyId: string, sampleId: string, filename: string) {
  const base = sanitize(filename.replace(/\.pdf$/i, "")).slice(-70);
  return `${samplePrefix(companyId)}${sampleId}-${base}.pdf`;
}

/** True only for a public Vercel Blob URL under this company's samples folder. */
export function isSampleBlobUrl(url: string, companyId: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
    parsed.pathname.startsWith(`/${samplePrefix(companyId)}`)
  );
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
