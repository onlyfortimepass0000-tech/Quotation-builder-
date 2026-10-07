import { put, del } from "@vercel/blob";

/**
 * Thin wrapper around Vercel Blob so nothing else in the app talks to the
 * Blob SDK directly. putFile returns the blob's public URL — callers store
 * that URL (not a bare key) in the DB and pass it straight back into
 * getFile/deleteFile. Files are public (no auth layer existed before this
 * migration either — the old R2 proxy route had no access check).
 */
export async function putFile(
  key: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string> {
  const body = data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(new Uint8Array(data));
  const blob = await put(key, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return blob.url;
}

export async function getFile(
  url: string
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  return {
    body: res.body,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function deleteFile(url: string): Promise<void> {
  await del(url).catch(() => {});
}

export function sampleKey(companyId: string, sampleId: string, filename: string) {
  return `companies/${companyId}/samples/${sampleId}-${sanitize(filename)}`;
}

export function assetKey(companyId: string, templateVersionId: string, kind: string, ext: string) {
  return `companies/${companyId}/templates/${templateVersionId}/${kind}.${ext}`;
}

/** Manually-uploaded, company-wide branding image (not tied to any one template version). */
export function brandingKey(companyId: string, kind: "logo" | "signature", ext: string) {
  return `companies/${companyId}/branding/${kind}-${Date.now()}.${ext}`;
}

export function quoteKey(companyId: string, quoteId: string) {
  return `companies/${companyId}/quotes/${quoteId}.pdf`;
}

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}
