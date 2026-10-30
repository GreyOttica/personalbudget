"use client";

import { ColumnChart, type Series } from "@/components/charts/charts";
import { formatCents, formatInt } from "@/lib/format";

const INCOME: Series = { key: "income", name: "Entrate", color: "var(--series-income)" };
const EXPENSE: Series = { key: "expense", name: "Spese", color: "var(--series-expense)" };
const INVEST: Series = { key: "investment", name: "Investito", color: "var(--series-invest)" };

export function YearChart({ months }: { months: { month: string; label: string; title: string; income: number; expense: number; investment: number }[] }) {
  return (
    <ColumnChart
      points={months.map((m) => ({
        key: m.month,
        label: m.label.slice(0, 1).toUpperCase(),
        title: m.title,
        values: { income: m.income / 100, expense: m.expense / 100, investment: m.investment / 100 },
      }))}
      series={[INCOME, EXPENSE, INVEST]}
      formatTick={(v) => formatInt(v)}
      formatValue={(v) => formatCents(Math.round(v * 100))}
      ariaLabel="Entrate, spese e investimenti per mese dell'anno"
      tableCaption="Entrate, spese e investimenti per mese"
    />
  );
}
