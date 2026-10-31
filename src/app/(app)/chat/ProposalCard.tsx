"use client";

import Link from "next/link";
import { useState } from "react";
import type { Proposal } from "@/lib/ai/chat";
import { applyProposal } from "./actions";

const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("it-IT")} €`;
const e = (euros: number) => `${euros.toLocaleString("it-IT")} €`;

/** Proposta di budget: cifre calcolate dall'app, si applica con un tasto. */
export function ProposalCard({ p }: { p: Proposal }) {
  const [applied, setApplied] = useState(p.applied_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = p.summary;
  return (
    <div className="proposal">
      <span className="analysis-kind">Proposta di budget</span>
      <table className="proposal-table">
        <thead>
          <tr>
            <th scope="col">Categoria</th>
            <th scope="col">Ora</th>
            <th scope="col">Nuovo</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.category_id}>
              <td>
                {i.emoji} {i.name}
                <span className="muted small"> media {eur(i.average_cents)}</span>
              </td>
              <td className="muted">{i.from_cents === null ? "—" : eur(i.from_cents)}</td>
              <td>
                <strong>{i.to_cents === 0 ? "nessuno" : eur(i.to_cents)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="proposal-sum small">
        <span>
          Budget totale: {e(s.budget_totale_attuale)} → <strong>{e(s.budget_totale_proposto)}</strong>
        </span>
        <span>
          Risparmio previsto: <strong>{e(s.risparmio_mensile_previsto)}/mese</strong>
          {s.risparmio_pct_previsto !== null && ` (${String(s.risparmio_pct_previsto).replace(".", ",")}%`}
          {s.risparmio_pct_previsto !== null && s.risparmio_pct_medio_attuale !== null && `, oggi in media ${String(s.risparmio_pct_medio_attuale).replace(".", ",")}%`}
          {s.risparmio_pct_previsto !== null && ")"}
        </span>
      </div>
      {s.avvisi.length > 0 && (
        <ul className="proposal-warn small">
          {s.avvisi.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {applied ? (
        <p className="good-text small">
          ✓ Applicata dal mese in corso. <Link href="/budget">Vedi i budget</Link>
        </p>
      ) : (
        <button
          type="button"
          className="button button-compact"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await applyProposal(p.id);
            if (r.ok) setApplied(r.appliedAt ?? new Date().toISOString());
            else setError(r.error ?? "Non applicata");
            setBusy(false);
          }}
        >
          {busy ? "Applico…" : "Applica dal mese in corso"}
        </button>
      )}
      {error && <p className="check-diff small">{error}</p>}
    </div>
  );
}
