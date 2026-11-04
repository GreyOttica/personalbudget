"use client";

import { useState, useTransition } from "react";
import { Meter, StatusLabel } from "@/components/Meter";
import type { BudgetStatus } from "@/lib/analytics/dashboard";
import { centsToInput, parseAmount } from "@/lib/entry/amount";
import { formatEuros, formatProbability } from "@/lib/format";
import { saveBudgets } from "./actions";

type Row = {
  id: string;
  name: string;
  emoji: string;
  isFixed: boolean;
  budget: number | null;
  proposal: number;
  average: number;
  spent: number;
  forecast: number | null;
  status: BudgetStatus;
  probOver: number | null;
};

const toText = (cents: number | null) => (cents ? centsToInput(cents).replace(/,00$/, "") : "");

export function BudgetEditor({ rows, months }: { rows: Row[]; months: number }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, toText(r.budget)])));
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasBudgets = rows.some((r) => r.budget !== null);

  const cents = (id: string) => (values[id]?.trim() ? parseAmount(values[id]) : 0);
  const invalid = rows.filter((r) => cents(r.id) === null);
  const total = rows.reduce((s, r) => s + (cents(r.id) ?? 0), 0);
  const proposalTotal = rows.reduce((s, r) => s + r.proposal, 0);
  const dirty = rows.some((r) => (cents(r.id) ?? -1) !== (r.budget ?? 0));

  function set(id: string, v: string) {
    setSaved(null);
    setValues((x) => ({ ...x, [id]: v }));
  }

  function applyProposals() {
    setSaved(null);
    setValues(Object.fromEntries(rows.map((r) => [r.id, toText(r.proposal)])));
  }

  function save() {
    if (invalid.length) return;
    setError(null);
    start(async () => {
      const res = await saveBudgets(rows.map((r) => ({ categoryId: r.id, cents: cents(r.id) ?? 0 })));
      if (res.ok) setSaved("Budget salvati: valgono da questo mese in poi.");
      else setError(res.error);
    });
  }

  return (
    <main className="page">
      <h1>Budget mensili</h1>
      <p className="muted">
        Un tetto di spesa al mese per categoria. Ti avviso oltre l&apos;80% e al 100%. Valgono da questo mese in poi.
      </p>

      <section className="card card-padded budget-proposal">
        <div>
          <strong>Proposta: {formatEuros(proposalTotal)} al mese</strong>
          <p className="muted small">
            Per ogni categoria il livello che hai rispettato circa 2 mesi su 3 negli ultimi {months >= 12 ? 12 : months}{" "}
            {months === 1 ? "mese" : "mesi"}, con più peso ai mesi recenti: raggiungibile ma non largo. Arrotondato a 5 €; per le
            spese fisse il ricorrente o l&apos;importo del mese scorso.
          </p>
        </div>
        <button type="button" className="button button-secondary" onClick={applyProposals}>
          {hasBudgets ? "Usa le proposte" : "Parti dalle proposte"}
        </button>
      </section>

      <ul className="card budget-list">
        {rows.map((r) => {
          const bad = cents(r.id) === null;
          return (
            <li key={r.id} className="budget-row">
              <span className="cat-emoji" aria-hidden>
                {r.emoji}
              </span>
              <div className="budget-main">
                <label htmlFor={`b-${r.id}`} className="cat-name">
                  {r.name}
                  {r.isFixed && <span className="pill">fissa</span>}
                </label>
                <span className="muted small">
                  questo mese <strong className="budget-spent">{formatEuros(r.spent)}</strong>
                  {r.forecast !== null && r.forecast > r.spent ? ` · stima ${formatEuros(r.forecast)}` : ""} · media {formatEuros(r.average)}
                  {r.proposal !== r.average && r.proposal > 0 ? ` · proposta ${formatEuros(r.proposal)}` : ""}
                </span>
                {r.probOver != null && r.budget !== null && r.status !== "over" && (
                  <span className={`small ${r.probOver >= 0.65 ? "check-diff" : r.probOver <= 0.2 ? "good-text" : "muted"}`}>
                    Probabilità di sforare: {formatProbability(r.probOver)}
                  </span>
                )}
                {r.budget !== null && (
                  <div className="budget-meter">
                    <Meter
                      ratio={r.spent / r.budget}
                      status={r.status}
                      forecastRatio={r.forecast !== null ? r.forecast / r.budget : null}
                      label={`${r.name}: speso ${formatEuros(r.spent)} su ${formatEuros(r.budget)}`}
                    />
                    {(r.status === "warning" || r.status === "over") && <StatusLabel status={r.status} />}
                  </div>
                )}
              </div>
              <div className={`budget-input ${bad ? "invalid" : ""}`}>
                <input
                  id={`b-${r.id}`}
                  value={values[r.id] ?? ""}
                  onChange={(e) => set(r.id, e.target.value)}
                  inputMode="decimal"
                  placeholder="—"
                  aria-invalid={bad}
                />
                <span aria-hidden>€</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="budget-footer">
        <div>
          <span className="muted small">Totale budget</span>
          <strong>{formatEuros(total)}</strong>
        </div>
        <button type="button" className="button" onClick={save} disabled={pending || !!invalid.length || !dirty}>
          {pending ? "Salvo…" : "Salva"}
        </button>
      </div>
      {invalid.length > 0 && <p className="alert">Controlla gli importi di: {invalid.map((r) => r.name).join(", ")}.</p>}
      {error && <p className="alert">{error}</p>}
      {saved && <p className="ok">{saved}</p>}
      <p className="muted small">Lascia vuoto per non avere un budget su quella categoria.</p>
    </main>
  );
}
