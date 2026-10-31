"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const KINDS = [
  { kind: "daily", label: "Serale", hint: "oggi" },
  { kind: "weekly", label: "Settimana", hint: "la scorsa" },
  { kind: "monthly", label: "Mese", hint: "lo scorso" },
] as const;

/** "Genera ora": in attesa dei job automatici della Fase 5, o per rigenerare. */
export function GenerateButtons({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: string) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(body.error ?? `Errore ${res.status}`);
      else router.refresh();
    } catch {
      setError("Serve la connessione a internet.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="generate">
      <span className="group-title">Genera ora</span>
      <div className="generate-row">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className="button button-secondary generate-btn" disabled={disabled || busy !== null} onClick={() => run(k.kind)}>
            <strong>{busy === k.kind ? "Analizzo…" : k.label}</strong>
            <span className="muted small">{k.hint}</span>
          </button>
        ))}
      </div>
      {busy && <p className="muted small">Ci vogliono 20–60 secondi.</p>}
      {error && <p className="check-diff small">{error}</p>}
    </section>
  );
}
