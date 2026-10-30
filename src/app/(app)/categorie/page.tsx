import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/charts/more";
import { PageHeader } from "@/components/PageHeader";
import { monthOf } from "@/lib/analytics/dashboard";
import { categoryTrends } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonthName } from "@/lib/format";

export const metadata: Metadata = { title: "Categorie nel tempo" };

export default async function CategoryTrendsPage() {
  const { txns, categories } = await loadAll();
  const month = monthOf(romeDate());
  const trends = categoryTrends(txns, categories, month);
  return (
    <main className="page">
      <PageHeader title="Categorie nel tempo" subtitle={`Ultimi 12 mesi. A destra: ${formatMonthName(month)} rispetto alla media dei mesi precedenti.`} />
      <ul className="card trend-list">
        {trends.map((t) => {
          const up = t.delta > 0;
          const flat = Math.abs(t.delta) < 500;
          return (
            <li key={t.id} className="trend-row">
              <span className="cat-emoji" aria-hidden>
                {t.emoji}
              </span>
              <div className="trend-main">
                <span className="cat-name">
                  {t.name}
                  {t.isFixed && <span className="pill">fissa</span>}
                </span>
                <span className="muted small">media {formatEuros(t.average)} al mese</span>
              </div>
              <Sparkline values={t.values.map((v) => v.amount)} />
              <span className="trend-now">
                <strong>{formatEuros(t.current)}</strong>
                <span className={`delta ${flat ? "" : up ? "delta-bad" : "delta-good"}`}>
                  {flat ? "in linea" : `${up ? "▲ +" : "▼ −"}${formatEuros(Math.abs(t.delta))}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        Il mese in corso non è ancora finito: per una stima di fine mese guarda la <Link href="/">Home</Link>.
      </p>
    </main>
  );
}
