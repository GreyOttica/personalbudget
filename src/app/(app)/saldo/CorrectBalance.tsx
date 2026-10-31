"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { parseAmount } from "@/lib/entry/amount";
import { formatCents } from "@/lib/format";
import { deleteCheckpoint, saveCheckpoint } from "./actions";

const dayFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));

/** "1.234,56" o "-120" → centesimi con segno (il saldo può essere negativo). */
function parseSigned(v: string): number | null {
  const t = v.trim();
  const neg = t.startsWith("-") || t.startsWith("−");
  const cents = parseAmount(neg ? t.slice(1) : t);
  if (cents === null) return t.replace(/[-−\s€]/g, "") === "0" ? 0 : null;
  return neg ? -cents : cents;
}

export function CorrectBalance({ today, estimate, checkpoints }: { today: string; estimate: number; checkpoints: { id: string; as_of: string; balance_cents: number }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cents = parseSigned(amount);

  const run = (fn: () => ReturnType<typeof saveCheckpoint>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        after?.();
        router.refresh();
      } else setError(res.error);
    });

  return (
    <section className="list list-form correct-balance">
      {!open ? (
        <button type="button" className="list-action" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
          Correggi con il saldo reale
        </button>
      ) : (
        <form
          className="rule-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null) run(() => saveCheckpoint(date, cents), () => { setOpen(false); setAmount(""); });
          }}
        >
          <strong>Saldo reale del conto</strong>
          <p className="muted small">
            Guardalo nell&apos;app della banca. Vale a fine giornata: i movimenti di quel giorno si considerano già compresi.
          </p>
          <div className="form-row">
            <label className="field">
              <span>Saldo (€)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={formatCents(estimate).replace(" €", "")} autoFocus aria-invalid={amount !== "" && cents === null} />
            </label>
            <label className="field">
              <span>Al</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {cents !== null && date === today && (
            <p className="muted small">
              Differenza dalla stima di oggi: {cents - estimate >= 0 ? "+" : "−"}
              {formatCents(Math.abs(cents - estimate))}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button-secondary" onClick={() => setOpen(false)}>
              Annulla
            </button>
            <button type="submit" className="button" disabled={cents === null || pending}>
              Salva
            </button>
          </div>
        </form>
      )}
      {error && <p className="alert">{error}</p>}
      {checkpoints.length > 0 && (
        <ul className="checkpoints">
          {[...checkpoints].reverse().map((c) => (
            <li key={c.id}>
              <span>{fmtDay(c.as_of)}</span>
              <strong>{formatCents(c.balance_cents)}</strong>
              <button
                type="button"
                className="link-button small danger-link"
                onClick={() => window.confirm("Eliminare questo saldo reale?") && run(() => deleteCheckpoint(c.id))}
              >
                Elimina
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
