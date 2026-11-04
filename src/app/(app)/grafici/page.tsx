import type { Metadata } from "next";
import Link from "next/link";
import { MonthSwitch } from "@/components/MonthSwitch";
import { monthOf } from "@/lib/analytics/dashboard";
import { categoryColorSlots, composition, smallSpends } from "@/lib/analytics/insights";
import { loadDashboard, parseMonth } from "@/lib/analytics/load";
import { romeDate } from "@/lib/entry/amount";
import { formatMonthName } from "@/lib/format";
import { DailyFocus, TrendCharts } from "../DashboardCharts";
import { Composition, MonthFlow, SmallSpends } from "../HomeInsights";

export const metadata: Metadata = { title: "Grafici" };

/** I grafici del mese, spostati dalla Home: giorno per giorno, composizione, piccole spese, flusso, andamento. */
export default async function ChartsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = parseMonth(m);
  const { dashboard: d, categories, subcategories, txns } = await loadDashboard(month);
  const slots = categoryColorSlots(txns, month);
  const comp = composition(txns, categories, month, slots);
  const small = smallSpends(txns, categories, subcategories, month);
  const monthName = formatMonthName(month);

  return (
    <main className="page dash">
      <Link href="/altro" className="back-link">
        ‹ Altro
      </Link>
      <header className="dash-top">
        <MonthSwitch month={month} current={monthOf(romeDate())} base="/grafici" />
      </header>

      {d.trend.length === 0 ? (
        <section className="card card-padded">
          <p className="muted">Non ci sono ancora movimenti da mostrare.</p>
        </section>
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2>Giorno per giorno</h2>
            </div>
            <DailyFocus daily={d.daily} isCurrentMonth={d.isCurrentMonth} showToday={false} />
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Dove vanno i soldi</h2>
              <span className="muted small">{monthName}</span>
            </div>
            <Composition slices={comp.slices} total={comp.total} other={comp.other} subcategories={d.subcategories} />
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Piccole spese che si sommano</h2>
            </div>
            <SmallSpends items={small.items} total={small.total} count={small.count} />
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Flusso del mese</h2>
            </div>
            <MonthFlow d={d} slots={Object.fromEntries(slots)} />
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Andamento</h2>
              <span className="muted small">ultimi {d.trend.length} mesi</span>
            </div>
            <TrendCharts trend={d.trend} selected={month} />
          </section>
          <p className="muted small more-analysis">
            Ogni categoria mese per mese, con la media: <Link href="/categorie">Categorie nel tempo</Link>. Il riepilogo
            dell&apos;anno: <Link href="/anno">Il tuo {month.slice(0, 4)}</Link>.
          </p>
        </>
      )}
    </main>
  );
}
