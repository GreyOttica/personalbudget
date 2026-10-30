"use client";

import { ColumnChart, LineChart, type Series } from "@/components/charts/charts";
import { formatCents, formatInt } from "@/lib/format";

const BALANCE: Series = { key: "balance", name: "Saldo", color: "var(--series-expense)" };
const NET: Series = { key: "net", name: "Variazione del mese", color: "var(--series-income)" };

type P = { key: string; label: string; title: string; balance: number; net: number };

export function BalanceChart({ points }: { points: P[] }) {
  const pts = points.map((p) => ({ key: p.key, label: p.label, title: p.title, values: { balance: p.balance / 100, net: p.net / 100 } }));
  return (
    <>
      <LineChart
        points={pts}
        series={[BALANCE]}
        formatTick={(v) => formatInt(v)}
        formatValue={(v) => formatCents(Math.round(v * 100))}
        ariaLabel="Saldo stimato del conto a fine mese"
        tableCaption="Saldo stimato a fine mese"
        height={200}
      />
      <h3 className="chart-title">Quanto è cambiato ogni mese</h3>
      <ColumnChart
        points={pts}
        series={[NET]}
        formatTick={(v) => formatInt(v)}
        formatValue={(v) => formatCents(Math.round(v * 100))}
        ariaLabel="Variazione del saldo per mese"
        tableCaption="Variazione del saldo per mese"
        height={170}
      />
    </>
  );
}
