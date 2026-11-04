import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { predictionFor } from "@/lib/ai/facts";
import { addMonths, monthOf } from "@/lib/analytics/dashboard";
import { balanceHistory } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { ewma, monthlySavings } from "@/lib/analytics/predict";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthName, formatPercent } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ClosingFlow } from "./ClosingFlow";

export const metadata: Metadata = { title: "Chiusura del mese" };

/** Chiusura guidata: saldo con la banca, com'è andata, budget del mese nuovo. Di default il mese scorso. */
export default async function ClosingPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const today = romeDate();
  const current = monthOf(today);
  const month = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m < current ? m : addMonths(current, -1);
  const all = await loadAll();
  const input = { ...all, today };
  const d = predictionFor(input, month).dashboard;
  const next = predictionFor(input, current).dashboard;

  // Saldo: stima dell'app oggi, senza un eventuale saldo reale già inserito oggi (è quello da confrontare).
  const balance = balanceHistory(all.txns, today, all.checkpoints.filter((c) => c.as_of < today));
  const savings = d.totals.income - d.totals.expense;
  const usualRaw = ewma(
    monthlySavings(
      all.txns.filter((t) => t.type !== "opening_balance"),
      month,
    ),
    3,
  );
  const usual = usualRaw === null ? null : Math.round(usualRaw);
  const over = d.categories.filter((c) => c.status === "over");
  const deltas = d.categories
    .filter((c) => !c.isFixed && d.averages.months > 0)
    .map((c) => ({ ...c, delta: c.spent - c.average }))
    .filter((c) => Math.abs(c.delta) >= 1000);
  const worse = [...deltas].sort((a, b) => b.delta - a.delta).filter((c) => c.delta > 0).slice(0, 3);
  const better = [...deltas].sort((a, b) => a.delta - b.delta).filter((c) => c.delta < 0).slice(0, 3);

  const supabase = await createClient();
  const { data: closure } = await supabase.from("month_closures").select("closed_at, balance_diff_cents").eq("month", month).maybeSingle();

  const proposals = next.categories
    .filter((c) => c.proposal > 0 || c.budget !== null)
    .map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, isFixed: c.isFixed, budget: c.budget, proposal: c.proposal }))
    .sort((a, b) => b.proposal - a.proposal);

  return (
    <main className="page closing">
      <PageHeader title={`Chiusura di ${formatMonthName(month)}`} subtitle="Un minuto per controllare il saldo, vedere com'è andata e preparare il mese nuovo." back="/" backLabel="Home" />
      {closure && (
        <p className="good-text small">
          ✓ Chiuso il {new Date(closure.closed_at).toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" })}. Puoi rifarlo quando vuoi.
        </p>
      )}

      <ClosingFlow
        month={month}
        monthLabel={formatMonth(`${month}-01`)}
        nextLabel={formatMonthName(current)}
        today={today}
        estimatedBalance={balance.current}
        proposals={proposals}
        savingsTarget={all.savingsTarget}
        closed={!!closure}
      >
        <h2 className="group-title">2 · Com&apos;è andato {formatMonthName(month)}</h2>
        <section className="card card-padded closing-recap">
          <div className="closing-grid">
            <div>
              <span className="muted small">Entrate</span>
              <strong>{formatEuros(d.totals.income)}</strong>
            </div>
            <div>
              <span className="muted small">Spese</span>
              <strong>{formatEuros(d.totals.expense)}</strong>
            </div>
            <div>
              <span className="muted small">Risparmio</span>
              <strong className={savings >= 0 ? "good-text" : "check-diff"}>{formatEuros(savings)}</strong>
              {d.totals.savingsRate !== null && <span className="muted small">{formatPercent(d.totals.savingsRate)} delle entrate</span>}
            </div>
          </div>
          {usual !== null && (
            <p className={`small ${savings >= usual ? "good-text" : "check-diff"}`}>
              {savings >= usual
                ? `👏 ${formatEuros(savings - usual)} più del solito (di solito ${formatEuros(usual)}).`
                : `${formatEuros(usual - savings)} meno del solito (di solito ${formatEuros(usual)}).`}
            </p>
          )}
          {over.length > 0 && (
            <p className="small">
              <strong>Budget superati:</strong> {over.map((c) => `${c.emoji} ${c.name} (${formatEuros(c.spent)} su ${formatEuros(c.budget ?? 0)})`).join(", ")}.
            </p>
          )}
          {worse.length > 0 && (
            <p className="small">
              <strong>Più del solito:</strong> {worse.map((c) => `${c.emoji} ${c.name} +${formatEuros(c.delta)}`).join(", ")}.
            </p>
          )}
          {better.length > 0 && (
            <p className="small">
              <strong>Meno del solito:</strong> {better.map((c) => `${c.emoji} ${c.name} −${formatEuros(-c.delta)}`).join(", ")}.
            </p>
          )}
          <p className="muted small">
            Il dettaglio: <Link href={`/grafici?m=${month}`}>grafici di {formatMonthName(month)}</Link> · <Link href="/analisi">report AI del mese</Link>.
          </p>
        </section>

      </ClosingFlow>
    </main>
  );
}
