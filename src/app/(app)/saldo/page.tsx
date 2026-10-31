import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { loadAll } from "@/lib/analytics/loadAll";
import { balanceHistory } from "@/lib/analytics/insights";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthShort } from "@/lib/format";
import { BalanceChart } from "./BalanceChart";
import { CorrectBalance } from "./CorrectBalance";

export const metadata: Metadata = { title: "Saldo del conto" };

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function BalancePage() {
  const { txns, checkpoints } = await loadAll();
  const today = romeDate();
  const b = balanceHistory(txns, today, checkpoints);
  const last = b.points.at(-1);
  const prev = b.points.at(-2);
  return (
    <main className="page">
      <PageHeader title="Saldo del conto" subtitle="Ultimo saldo reale (o iniziale) + entrate − spese − investimenti registrati dopo." />
      <section className="card hero">
        <p className="hero-label">Saldo stimato oggi</p>
        <p className="hero-value">{formatEuros(b.current)}</p>
        {last && prev && (
          <p className={`delta ${last.net >= 0 ? "delta-good" : "delta-bad"}`}>
            <span aria-hidden>{last.net >= 0 ? "▲" : "▼"}</span> {last.net >= 0 ? "+" : "−"}
            {formatEuros(Math.abs(last.net))} questo mese
          </p>
        )}
        <p className="muted small">
          {b.anchor.kind === "checkpoint" && b.anchor.date
            ? `Parte dal saldo reale di ${formatEuros(b.anchor.amount)} del ${shortDate(b.anchor.date)}.`
            : b.opening
              ? `Parte dal saldo iniziale di ${formatEuros(b.opening.amount)} del ${shortDate(b.opening.date)}. Se non coincide con la banca, correggilo qui sotto.`
              : "Non c'è un saldo di partenza: inseriscine uno reale qui sotto."}
        </p>
        {b.lastCheck && b.lastCheck.difference !== 0 && (
          <p className="small check-diff">
            Il {shortDate(b.lastCheck.date)} la stima diceva {formatEuros(b.lastCheck.estimated)}: mancavano {formatEuros(Math.abs(b.lastCheck.difference))}{" "}
            {b.lastCheck.difference < 0 ? "di spese" : "di entrate"} non registrate (o righe ignorate all&apos;import).
          </p>
        )}
      </section>
      <CorrectBalance today={today} estimate={b.current} checkpoints={checkpoints} />
      <section className="card card-padded">
        <h3 className="chart-title">Saldo a fine mese</h3>
        <BalanceChart points={b.points.map((p) => ({ key: p.month, label: formatMonthShort(p.month), title: formatMonth(`${p.month}-01`), balance: p.balance, net: p.net }))} />
      </section>
    </main>
  );
}
