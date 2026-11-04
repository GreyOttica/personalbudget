"use client";

import { useState } from "react";
import { centsToInput, parseAmount } from "@/lib/entry/amount";
import { formatEuros } from "@/lib/format";
import { saveSavingsTarget } from "./actions";

/** Obiettivo di risparmio mensile: base della quota giornaliera. Vuoto = come di solito. */
export function SavingsTarget({ current, usual, income }: { current: number | null; usual: number | null; income: number | null }) {
  const [text, setText] = useState(current === null ? "" : centsToInput(current).replace(/,00$/, ""));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    const v = value.trim();
    const cents = v === "" ? null : /^0+([.,]0+)?$/.test(v) ? 0 : parseAmount(v);
    if (v !== "" && cents === null) return setMsg({ ok: false, text: "Importo non valido." });
    setBusy(true);
    const r = await saveSavingsTarget(cents);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: cents === null ? "Userò il tuo risparmio di solito." : "Salvato: la quota giornaliera ora parte da qui." } : { ok: false, text: r.error ?? "Non salvato" });
  }

  return (
    <section className="page savings-target-page" aria-label="Obiettivo di risparmio">
      <h2 className="group-title">Obiettivo di risparmio</h2>
      <section className="card card-padded savings-target">
        <p className="small">
          Quanto vuoi mettere da parte ogni mese (entrate meno spese; gli investimenti contano come risparmio). Da qui l&apos;app calcola la{" "}
          <strong>quota di spesa di ogni giorno</strong> in Home.
        </p>
        <div className="savings-target-row">
          <label className="field">
            <span className="sr-only">Obiettivo di risparmio mensile</span>
            <input
              inputMode="decimal"
              value={text}
              placeholder={usual !== null ? centsToInput(Math.max(0, usual)).replace(/,00$/, "") : "es. 400"}
              onChange={(e) => setText(e.target.value)}
              aria-label="Obiettivo di risparmio mensile in euro"
            />
          </label>
          <span>€ al mese</span>
          <button type="button" className="button button-compact" disabled={busy} onClick={() => save(text)}>
            Salva
          </button>
        </div>
        <p className="muted small">
          {usual !== null ? `Di solito risparmi ${formatEuros(usual)} al mese (media che pesa di più i mesi recenti). ` : ""}
          {income ? `Entrate previste questo mese: ${formatEuros(income)}. ` : ""}
          Lascia vuoto per usare il tuo risparmio di solito.
        </p>
        {current !== null && (
          <button type="button" className="link-button small" disabled={busy} onClick={() => { setText(""); void save(""); }}>
            Torna a «come di solito»
          </button>
        )}
        {msg && <p className={`small ${msg.ok ? "good-text" : "check-diff"}`}>{msg.text}</p>}
      </section>
    </section>
  );
}
