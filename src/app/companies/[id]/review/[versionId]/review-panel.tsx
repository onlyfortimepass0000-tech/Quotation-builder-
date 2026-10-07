"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VariableField, FieldType, LayoutSlot, PricingLogic, PricingPresetId } from "@/lib/template-schema";
import { FIELD_TYPES, LAYOUT_SLOTS, SLOT_LABELS, MAX_VARIABLE_FIELDS, PRICING_PRESETS } from "@/lib/template-schema";

export default function ReviewPanel({
  companyId,
  versionId,
  status,
  initialFields,
  initialPricingLogic,
}: {
  companyId: string;
  versionId: string;
  status: string;
  initialFields: VariableField[];
  initialPricingLogic: PricingLogic | null;
}) {
  const [fields, setFields] = useState<VariableField[]>(initialFields);
  const [pricingLogic, setPricingLogic] = useState<PricingLogic>(
    initialPricingLogic ?? { detected: false, presetId: "qty_rate" }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const readOnly = status !== "pending_review";

  function updateField(i: number, patch: Partial<VariableField>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addField() {
    if (fields.length >= MAX_VARIABLE_FIELDS) return;
    setFields((prev) => [
      ...prev,
      { key: `field${prev.length + 1}`, label: "New field", type: "text", slot: "client_info", confidence: 1 },
    ]);
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/companies/${companyId}/template-versions/${versionId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editedFields: fields, editedPricingLogic: pricingLogic }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Approve failed");
      router.push(`/companies/${companyId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await fetch(`/api/companies/${companyId}/template-versions/${versionId}/reject`, {
        method: "POST",
      });
      router.push(`/companies/${companyId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <h2 className="font-medium">Pricing logic</h2>
        <div className="grid sm:grid-cols-3 gap-2">
          {PRICING_PRESETS.map((preset) => {
            const selected = (pricingLogic.presetId ?? "qty_rate") === preset.id;
            const isDetectedDefault =
              pricingLogic.detected && (pricingLogic.presetId ?? "qty_rate") === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={readOnly}
                onClick={() => setPricingLogic((p) => ({ ...p, presetId: preset.id as PricingPresetId }))}
                className={
                  "text-left rounded-md border p-3 text-sm transition-colors disabled:cursor-default " +
                  (selected
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200 hover:border-neutral-400")
                }
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{preset.label}</span>
                  {isDetectedDefault && (
                    <span className="text-[10px] rounded-full bg-green-100 text-green-700 px-1.5 py-0.5">
                      detected
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-1">{preset.description}</p>
              </button>
            );
          })}
        </div>
        {pricingLogic.description && (
          <p className="text-xs text-neutral-400">Analysis notes: {pricingLogic.description}</p>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">
            Variable fields{" "}
            <span className="text-xs text-neutral-400 font-normal">
              ({fields.length}/{MAX_VARIABLE_FIELDS})
            </span>
          </h2>
          {!readOnly && fields.length < MAX_VARIABLE_FIELDS && (
            <button
              onClick={addField}
              type="button"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              + Add field
            </button>
          )}
        </div>

        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="rounded-md border border-neutral-200 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  disabled={readOnly}
                  value={f.label}
                  onChange={(e) => updateField(i, { label: e.target.value })}
                  className="flex-1 min-w-[140px] rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
                  placeholder="Label"
                />
                <select
                  disabled={readOnly}
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  disabled={readOnly}
                  value={f.slot}
                  onChange={(e) => updateField(i, { slot: e.target.value as LayoutSlot })}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50"
                >
                  {LAYOUT_SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {SLOT_LABELS[s]}
                    </option>
                  ))}
                </select>
                <span
                  className={
                    "text-[11px] rounded-full px-2 py-0.5 " +
                    (f.confidence >= 0.75
                      ? "bg-green-100 text-green-700"
                      : f.confidence >= 0.5
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700")
                  }
                >
                  {Math.round(f.confidence * 100)}% confidence
                </span>
                {!readOnly && (
                  <button
                    onClick={() => removeField(i)}
                    type="button"
                    className="text-xs text-red-600 hover:underline ml-auto"
                  >
                    Remove
                  </button>
                )}
              </div>
              {f.notes && <p className="text-xs text-neutral-400">{f.notes}</p>}
            </div>
          ))}
          {fields.length === 0 && (
            <p className="text-sm text-neutral-400">No variable fields — add at least one.</p>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        {!readOnly && (
          <div className="flex gap-2 pt-2">
            <button
              onClick={approve}
              disabled={busy || fields.length === 0}
              className="rounded-md bg-green-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? "Working…" : "Approve & Activate"}
            </button>
            <button
              onClick={reject}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              Reject
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
