"use client";

import { useState } from "react";
import type { VariableField } from "@/lib/template-schema";

type LineItemRow = Record<string, string>;

function emptyRow(field: VariableField): LineItemRow {
  const row: LineItemRow = {};
  for (const c of field.columns ?? []) row[c.key] = "";
  return row;
}

export default function GenerateForm({
  companyId,
  fields,
}: {
  companyId: string;
  fields: VariableField[];
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "line_items") init[f.key] = [emptyRow(f)];
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ downloadUrl: string } | null>(null);

  function setSimple(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function setRow(field: VariableField, rowIndex: number, colKey: string, value: string) {
    setValues((prev) => {
      const rows = [...((prev[field.key] as LineItemRow[]) ?? [])];
      const updated = { ...rows[rowIndex], [colKey]: value };

      // Auto-fill an "amount"-like column from qty * rate so users don't
      // have to compute and retype something the template already implies.
      const qtyCol = field.columns?.find((c) => /qty|quantity/i.test(c.key))?.key;
      const rateCol = field.columns?.find((c) => /rate|price/i.test(c.key))?.key;
      const amountCol = field.columns?.find((c) => /amount|total/i.test(c.key))?.key;
      if (qtyCol && rateCol && amountCol && (colKey === qtyCol || colKey === rateCol)) {
        const qty = Number(updated[qtyCol]) || 0;
        const rate = Number(updated[rateCol]) || 0;
        if (qty && rate) updated[amountCol] = String(qty * rate);
      }

      rows[rowIndex] = updated;
      return { ...prev, [field.key]: rows };
    });
  }

  function addRow(field: VariableField) {
    setValues((prev) => ({
      ...prev,
      [field.key]: [...((prev[field.key] as LineItemRow[]) ?? []), emptyRow(field)],
    }));
  }

  function removeRow(field: VariableField, rowIndex: number) {
    setValues((prev) => ({
      ...prev,
      [field.key]: ((prev[field.key] as LineItemRow[]) ?? []).filter((_, i) => i !== rowIndex),
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.type === "line_items") {
          const rows = (values[f.key] as LineItemRow[]) ?? [];
          payload[f.key] = rows.map((row) => {
            const converted: Record<string, string | number> = {};
            for (const c of f.columns ?? []) {
              converted[c.key] = c.type === "number" || c.type === "currency" ? Number(row[c.key]) || 0 : row[c.key] ?? "";
            }
            return converted;
          });
        } else if (f.type === "number" || f.type === "currency") {
          payload[f.key] = Number(values[f.key]) || 0;
        } else {
          payload[f.key] = values[f.key] ?? "";
        }
      }

      const res = await fetch(`/api/companies/${companyId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: payload }),
      });
      const json = (await res.json()) as {
        error?: string;
        quote?: { id: string; downloadUrl: string };
      };
      if (!res.ok || !json.quote) throw new Error(json.error ?? "Generation failed");
      setResult(json.quote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-neutral-200 bg-white p-4">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <label className="text-sm font-medium">{f.label}</label>

          {f.type === "line_items" ? (
            <div className="space-y-2">
              {((values[f.key] as LineItemRow[]) ?? []).map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  {(f.columns ?? []).map((c) => (
                    <input
                      key={c.key}
                      value={row[c.key] ?? ""}
                      onChange={(e) => setRow(f, i, c.key, e.target.value)}
                      placeholder={c.label}
                      type={c.type === "text" ? "text" : "number"}
                      className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => removeRow(f, i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addRow(f)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                + Add row
              </button>
            </div>
          ) : f.type === "textarea" ? (
            <textarea
              value={(values[f.key] as string) ?? ""}
              onChange={(e) => setSimple(f.key, e.target.value)}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
              rows={3}
            />
          ) : (
            <input
              value={(values[f.key] as string) ?? ""}
              onChange={(e) => setSimple(f.key, e.target.value)}
              type={f.type === "date" ? "date" : f.type === "number" || f.type === "currency" ? "number" : "text"}
              step={f.type === "currency" ? "0.01" : undefined}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {busy ? "Generating…" : "Generate quote PDF"}
      </button>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {result && (
        <p className="text-sm">
          ✅ Quote generated.{" "}
          <a href={result.downloadUrl} target="_blank" className="text-blue-600 font-medium hover:underline">
            Download PDF
          </a>
        </p>
      )}
    </form>
  );
}
