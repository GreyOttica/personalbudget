"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ColumnChart, LineChart, type Point, type Series } from "@/components/charts/charts";
import type { MonthPoint, SubcategoryRow } from "@/lib/analytics/dashboard";
import { formatCents, formatEuros, formatInt, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";

// Colori delle serie (slot 1–3 della palette validata): vedi --series-* in globals.css.
const EXPENSE: Series = { key: "expense", name: "Spese", color: "var(--series-expense)" };
const INCOME: Series = { key: "income", name: "Entrate", color: "var(--series-income)" };
const SAVINGS: Series = { key: "savings", name: "Risparmio", color: "var(--series-expense)" };

export function TrendCharts({ trend, selected }: { trend: MonthPoint[]; selected: string }) {
  const points: Point[] = trend.map((m) => ({
    key: m.month,
    label: formatMonthShort(m.month),
    title: formatMonth(`${m.month}-01`),
    values: { income: m.income / 100, expense: m.expense / 100, savings: m.savingsRate === null ? null : m.savingsRate * 100 },
  }));
  const openMonth = (p: Point) => (
    <Link href={`/?m=${p.key}`} className="tooltip-link">
      Apri il mese ›
    </Link>
  );

  return (
    <div className="card card-padded charts">
      <div>
        <h3 className="chart-title">Entrate e spese</h3>
        <ColumnChart
          points={points}
          series={[INCOME, EXPENSE]}
          formatTick={(v) => formatInt(v)}
          formatValue={(v) => formatCents(Math.round(v * 100))}
          tooltipExtra={openMonth}
          selectedKey={selected}
          ariaLabel="Entrate e spese mese per mese, in euro"
          tableCaption="Entrate e spese per mese"
        />
      </div>
      <div>
        <h3 className="chart-title">Percentuale di risparmio</h3>
        <p className="muted small chart-sub">(entrate − spese) / entrate: gli investimenti contano come risparmio</p>
        <LineChart
          points={points}
          series={[SAVINGS]}
          formatTick={(v) => `${formatInt(v)}%`}
          formatValue={(v) => formatPercent(v / 100)}
          tooltipExtra={openMonth}
          selectedKey={selected}
          ariaLabel="Percentuale di risparmio mese per mese"
          tableCaption="Percentuale di risparmio per mese"
        />
      </div>
    </div>
  );
}

/** Barre orizzontali per sottocategoria, con filtro per categoria. */
export function SubcategoryBreakdown({ rows }: { rows: SubcategoryRow[] }) {
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const categories = useMemo(() => {
    const m = new Map<string, { id: string; name: string; emoji: string; amount: number }>();
    for (const r of rows) {
      const c = m.get(r.categoryId) ?? { id: r.categoryId, name: r.categoryName, emoji: r.emoji, amount: 0 };
      c.amount += r.amount;
      m.set(r.categoryId, c);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [rows]);

  if (!rows.length) return <p className="muted">Nessuna spesa in questo mese.</p>;

  const filtered = category ? rows.filter((r) => r.categoryId === category) : rows;
  const visible = showAll ? filtered : filtered.slice(0, 8);
  const max = Math.max(...filtered.map((r) => r.amount));
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="card card-padded">
      <div className="chip-scroll" role="group" aria-label="Filtra per categoria">
        <button type="button" className={`chip chip-sm ${category === null ? "selected" : ""}`} onClick={() => setCategory(null)}>
          Tutte
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip chip-sm ${category === c.id ? "selected" : ""}`}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            {c.emoji} {c.name}
          </button>
        ))}
      </div>
      <ul className="hbars">
        {visible.map((r) => (
          <li key={`${r.categoryId}|${r.id}`} className="hbar">
            <div className="hbar-line">
              <span>
                {category ? "" : `${r.emoji} `}
                {r.name}
                <span className="muted small"> · {r.count}×</span>
              </span>
              <span className="hbar-value">{formatEuros(r.amount)}</span>
            </div>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${(r.amount / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="hbars-foot">
        <span className="muted small">Totale {formatEuros(total)}</span>
        {filtered.length > 8 && (
          <button type="button" className="link-button small" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Mostra meno" : `Mostra tutte (${filtered.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
