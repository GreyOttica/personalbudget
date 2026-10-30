import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { loadAll } from "@/lib/analytics/loadAll";
import { balanceHistory } from "@/lib/analytics/insights";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthShort } from "@/lib/format";
import { BalanceChart } from "./BalanceChart";

export const metadata: Metadata = { title: "Saldo del conto" };

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function BalancePage() {
  const { txns } = await loadAll();
  const b = balanceHistory(txns, romeDate());
  const last = b.points.at(-1);
  const prev = b.points.at(-2);
  return (
    <main className="page">
      <PageHeader title="Saldo del conto" subtitle="Stima: saldo iniziale + entrate − spese − investimenti registrati." />
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
          {b.opening
            ? `Parte dal saldo iniziale di ${formatEuros(b.opening.amount)} del ${shortDate(b.opening.date)}.`
            : "Non c'è un saldo iniziale registrato: la stima parte da zero."}{" "}
          Confrontalo ogni tanto con il saldo vero sull&apos;app della banca: se non coincide, manca qualche movimento.
        </p>
      </section>
      <section className="card card-padded">
        <h3 className="chart-title">Saldo a fine mese</h3>
        <BalanceChart points={b.points.map((p) => ({ key: p.month, label: formatMonthShort(p.month), title: formatMonth(`${p.month}-01`), balance: p.balance, net: p.net }))} />
      </section>
    </main>
  );
}
