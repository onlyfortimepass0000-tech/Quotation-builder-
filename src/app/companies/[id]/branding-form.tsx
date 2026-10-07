"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

function AssetSlot({
  label,
  field,
  currentKey,
  busy,
  onUpload,
  onRemove,
}: {
  label: string;
  field: "logo" | "signature";
  currentKey: string | null;
  busy: boolean;
  onUpload: (field: "logo" | "signature", file: File) => void;
  onRemove: (field: "logo" | "signature") => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {currentKey ? (
        <div className="flex items-center gap-3">
          <Image
            src={currentKey}
            alt={label}
            width={160}
            height={64}
            unoptimized
            className="h-16 w-auto max-w-[160px] object-contain rounded border border-neutral-200 bg-white"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(field)}
            className="text-xs text-red-600 hover:underline disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ) : (
        <p className="text-xs text-neutral-400">
          Not set — quotes will show a labeled placeholder box instead.
        </p>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(field, file);
          e.target.value = "";
        }}
        className="text-xs"
      />
    </div>
  );
}

export default function BrandingForm({
  companyId,
  logoR2Key,
  signatureR2Key,
}: {
  companyId: string;
  logoR2Key: string | null;
  signatureR2Key: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/branding`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update branding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update branding");
    } finally {
      setBusy(false);
    }
  }

  function onUpload(field: "logo" | "signature", file: File) {
    const form = new FormData();
    form.append(field, file);
    submit(form);
  }

  function onRemove(field: "logo" | "signature") {
    const form = new FormData();
    form.append(`remove${field[0].toUpperCase()}${field.slice(1)}`, "true");
    submit(form);
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
      <div>
        <h2 className="font-medium">Branding</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Upload your real logo and signature once — they&apos;ll be used on every generated quote
          instead of a placeholder box. You can replace or remove them anytime.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        <AssetSlot
          label="Company logo"
          field="logo"
          currentKey={logoR2Key}
          busy={busy}
          onUpload={onUpload}
          onRemove={onRemove}
        />
        <AssetSlot
          label="Authorized signature"
          field="signature"
          currentKey={signatureR2Key}
          busy={busy}
          onUpload={onUpload}
          onRemove={onRemove}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
