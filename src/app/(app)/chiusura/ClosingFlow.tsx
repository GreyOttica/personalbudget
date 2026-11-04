"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { centsToInput } from "@/lib/entry/amount";
import { formatCents, formatEuros } from "@/lib/format";
import { saveBudgets } from "../budget/actions";
import { saveCheckpoint } from "../saldo/actions";
import { closeMonth } from "./actions";

type Proposal = { id: string; name: string; emoji: string; isFixed: boolean; budget: number | null; proposal: number };

/** "1.234,56" o "-50" → centesimi (anche negativi: il saldo può andare sotto zero). */
function parseBalance(text: string): number | null {
  let s = text.replace(/[\s€]/g, "");
  if (!s) return null;
  const neg = s.startsWith("-") || s.startsWith("−");
  s = s.replace(/^[-−]/, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = Math.round(Number(s) * 100);
  return neg ? -c : c;
}

export function ClosingFlow(props: {
  month: string;
  monthLabel: string;
  nextLabel: string;
  today: string;
  estimatedBalance: number;
  proposals: Proposal[];
  savingsTarget: number | null;
  closed: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [diff, setDiff] = useState<number | null>(null);
  const [balanceMsg, setBalanceMsg] = useState<string | null>(null);
  const [budgetsDone, setBudgetsDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(props.closed);

  async function checkBalance() {
    const cents = parseBalance(text);
    if (cents === null) return setError("Scrivi il saldo come lo vedi nell'app della banca, per esempio 5.972,40.");
    setBusy(true);
    setError(null);
    const r = await saveCheckpoint(props.today, cents);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const d = cents - props.estimatedBalance;
    setDiff(d);
    setBalanceMsg(
      Math.abs(d) < 100
        ? "✓ Coincide con la banca: i movimenti sono completi."
        : d < 0
          ? `Nella banca ci sono ${formatCents(-d)} in meno: probabilmente mancano spese per circa questa cifra. Le trovi negli ultimi movimenti ING; da oggi l'app riparte dal saldo reale.`
          : `Nella banca ci sono ${formatCents(d)} in più: forse manca un'entrata o c'è una spesa registrata due volte. Da oggi l'app riparte dal saldo reale.`,
    );
  }

  async function applyProposals() {
    setBusy(true);
    setError(null);
    const r = await saveBudgets(props.proposals.map((p) => ({ categoryId: p.id, cents: p.proposal })));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBudgetsDone(true);
  }

  async function finish() {
    setBusy(true);
    const r = await closeMonth(props.month, diff);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Non salvato");
    setClosed(true);
    router.refresh();
  }

  const totalNow = props.proposals.reduce((s, p) => s + (p.budget ?? 0), 0);
  const totalNew = props.proposals.reduce((s, p) => s + p.proposal, 0);

  return (
    <>
      <h2 className="group-title">1 · Il saldo coincide con la banca?</h2>
      <section className="card card-padded closing-step">
        <p className="small">
          Apri l&apos;app ING e scrivi il saldo di oggi. Secondo l&apos;app dovrebbe essere <strong>{formatCents(props.estimatedBalance)}</strong>.
        </p>
        <div className="savings-target-row">
          <label className="field">
            <span className="sr-only">Saldo di oggi nella banca</span>
            <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={centsToInput(props.estimatedBalance)} aria-label="Saldo di oggi nella banca in euro" />
          </label>
          <span>€</span>
          <button type="button" className="button button-compact" disabled={busy || !text.trim()} onClick={checkBalance}>
            Confronta
          </button>
        </div>
        {balanceMsg && <p className={`small ${diff !== null && Math.abs(diff) < 100 ? "good-text" : "check-diff"}`}>{balanceMsg}</p>}
        {!balanceMsg && <p className="muted small">Puoi anche saltare questo passo.</p>}
      </section>

      {props.children}

      <h2 className="group-title">3 · Il mese nuovo: {props.nextLabel}</h2>
      <section className="card card-padded closing-step">
        <p className="small">
          Budget proposti: il livello che hai rispettato circa 2 mesi su 3, con più peso ai mesi recenti. Totale{" "}
          <strong>{formatEuros(totalNew)}</strong>
          {totalNow > 0 ? ` (ora ${formatEuros(totalNow)})` : ""}.
        </p>
        <ul className="closing-proposals">
          {props.proposals.map((p) => (
            <li key={p.id}>
              <span>
                {p.emoji} {p.name}
                {p.isFixed && <span className="pill">fissa</span>}
              </span>
              <span className="muted">{p.budget === null ? "—" : formatEuros(p.budget)}</span>
              <strong>{formatEuros(p.proposal)}</strong>
            </li>
          ))}
        </ul>
        {budgetsDone ? (
          <p className="good-text small">✓ Budget di {props.nextLabel} aggiornati.</p>
        ) : (
          <div className="button-row">
            <button type="button" className="button" disabled={busy} onClick={applyProposals}>
              Usa le proposte
            </button>
            <Link href="/budget" className="button button-secondary">
              Modifica
            </Link>
          </div>
        )}
        <p className="muted small">
          Obiettivo di risparmio: {props.savingsTarget === null ? "come di solito" : formatEuros(props.savingsTarget)} ·{" "}
          <Link href="/budget">cambialo in Budget</Link>
        </p>
      </section>

      {error && <p className="alert">{error}</p>}
      {closed ? (
        <p className="good-text closing-done">✓ {props.monthLabel} chiuso. Buon mese!</p>
      ) : (
        <button type="button" className="button button-big closing-finish" disabled={busy} onClick={finish}>
          Chiudi {props.monthLabel}
        </button>
      )}
    </>
  );
}
