import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { monthOf } from "@/lib/analytics/dashboard";
import { loadAll } from "@/lib/analytics/loadAll";
import { yearSummary } from "@/lib/analytics/insights";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { YearChart } from "./YearChart";

export const metadata: Metadata = { title: "Riepilogo dell'anno" };

export default async function YearPage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const { y } = await searchParams;
  const { txns, categories } = await loadAll();
  const current = Number(romeDate().slice(0, 4));
  const years = [...new Set(txns.map((t) => Number(t.occurred_on.slice(0, 4))))].sort();
  const year = y && /^\d{4}$/.test(y) && years.includes(Number(y)) ? Number(y) : current;
  const s = yearSummary(txns, categories, year, monthOf(romeDate()));
  const pct = (v: number | null) => (v === null ? "—" : formatPercent(v));
  const diff = (a: number, b: number) => (b ? (a - b) / b : null);

  return (
    <main className="page">
      <PageHeader title={`Il tuo ${year}`} subtitle={`${s.monthsWithData} ${s.monthsWithData === 1 ? "mese" : "mesi"} con movimenti`} />
      {years.length > 1 && (
        <div className="chip-list">
          {years.map((yy) => (
            <Link key={yy} href={`/anno?y=${yy}`} className={`chip chip-sm ${yy === year ? "selected" : ""}`}>
              {yy}
            </Link>
          ))}
        </div>
      )}

      <section className="tiles tiles-2">
        <div className="tile">
          <span className="tile-label">Entrate</span>
          <span className="tile-value">{formatEuros(s.totals.income)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Spese</span>
          <span className="tile-value">{formatEuros(s.totals.expense)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Investito</span>
          <span className="tile-value">{formatEuros(s.totals.investment)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Risparmio medio</span>
          <span className="tile-value">{pct(s.totals.savingsRate)}</span>
        </div>
      </section>

      <section className="card card-padded">
        <h3 className="chart-title">Mese per mese</h3>
        <YearChart months={s.months.map((m) => ({ ...m, label: formatMonthShort(m.month), title: formatMonth(`${m.month}-01`) }))} />
      </section>

      {(s.best || s.worst) && (
        <section className="card card-padded highlights">
          {s.best && (
            <div>
              <span className="muted small">Mese migliore</span>
              <strong>{formatMonth(`${s.best.month}-01`)}</strong>
              <span className="delta delta-good">risparmio {formatPercent(s.best.savingsRate)}</span>
            </div>
          )}
          {s.worst && (
            <div>
              <span className="muted small">Mese più difficile</span>
              <strong>{formatMonth(`${s.worst.month}-01`)}</strong>
              <span className="delta delta-bad">risparmio {formatPercent(s.worst.savingsRate)}</span>
            </div>
          )}
        </section>
      )}

      <h2 className="group-title">Dove sono andati i soldi</h2>
      <ul className="card cat-list">
        {s.topCategories.map((c) => (
          <li key={c.id} className="cat-row">
            <span className="cat-emoji" aria-hidden>
              {c.emoji}
            </span>
            <div className="cat-main">
              <div className="cat-line">
                <span className="cat-name">{c.name}</span>
                <span className="cat-amount">{formatEuros(c.amount)}</span>
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${c.share * 100}%` }} />
              </div>
              <span className="muted small">{formatPercent(c.share)} delle spese</span>
            </div>
          </li>
        ))}
      </ul>

      {s.previous && (
        <>
          <h2 className="group-title">Rispetto al {year - 1}</h2>
          <div className="card card-padded">
            <p className="muted small">
              Il {year - 1} ha {s.previous.months} {s.previous.months === 1 ? "mese" : "mesi"} di dati: il confronto è sui totali, non sulla media mensile
              {s.previous.months < 3 ? ", quindi la differenza in percentuale non avrebbe senso." : "."}
            </p>
            <ul className="plain-list">
              <li>
                Spese: {formatEuros(s.totals.expense)} contro {formatEuros(s.previous.expense)}
                {s.previous.months >= 3 && diff(s.totals.expense, s.previous.expense) !== null && ` (${formatPercent(diff(s.totals.expense, s.previous.expense)!)})`}
              </li>
              <li>
                Entrate: {formatEuros(s.totals.income)} contro {formatEuros(s.previous.income)}
              </li>
              <li>
                Risparmio: {pct(s.totals.savingsRate)} contro {pct(s.previous.savingsRate)}
              </li>
            </ul>
          </div>
        </>
      )}

      {s.tags.length > 0 && (
        <>
          <h2 className="group-title">Viaggi ed eventi</h2>
          <ul className="card menu">
            {s.tags.map((t) => (
              <li key={t.tag}>
                <Link href={`/viaggi?tag=${encodeURIComponent(t.tag)}`} className="menu-row">
                  <span className="menu-icon" aria-hidden>
                    🏷️
                  </span>
                  <span className="menu-main">
                    <strong>{t.tag}</strong>
                  </span>
                  <span>{formatEuros(t.amount)}</span>
                  <span className="chevron" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
