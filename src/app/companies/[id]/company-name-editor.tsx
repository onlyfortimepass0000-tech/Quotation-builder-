"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CompanyNameEditor({ companyId, name }: { companyId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    if (!value.trim() || value === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value.trim() }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setEditing(false);
              setValue(name);
            }
          }}
          className="text-2xl font-semibold border-b border-neutral-300 focus:outline-none focus:border-neutral-900 bg-transparent"
        />
        <button
          onClick={save}
          disabled={busy}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        rename
      </button>
    </div>
  );
}
