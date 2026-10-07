"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupCompanyForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as { error?: string; company?: { id: string } };
      if (!res.ok || !json.company) throw new Error(json.error ?? "Failed to set up company");
      router.push(`/companies/${json.company.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set up company");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Company name (you can change this later)"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        autoFocus
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-md bg-neutral-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {busy ? "Setting up…" : "Continue"}
      </button>
    </form>
  );
}
