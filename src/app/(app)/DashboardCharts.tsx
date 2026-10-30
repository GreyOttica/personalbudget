"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ColumnChart, LineChart, type Point, type Series } from "@/components/charts/charts";
import type { Daily, MonthPoint, SubcategoryRow } from "@/lib/analytics/dashboard";
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

// --- giorno per giorno ---------------------------------------------------------

const dayTitle = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const formatDayTitle = (iso: string) => dayTitle.format(new Date(`${iso}T00:00:00Z`));
const DAY_LABELS = new Set([1, 5, 10, 15, 20, 25, 30]);

const CUMULATIVE: Series = { key: "cumulative", name: "Spese variabili", color: "var(--series-expense)" };
const PACE: Series = { key: "pace", name: "Ritmo per il budget", color: "var(--muted)" };
const PACE_AVG: Series = { key: "pace", name: "Ritmo medio", color: "var(--muted)" };
const PER_DAY: Series = { key: "amount", name: "Spese", color: "var(--series-expense)" };

type View = "pace" | "days" | "week";

export function DailyFocus({ daily, isCurrentMonth }: { daily: Daily; isCurrentMonth: boolean }) {
  const [view, setView] = useState<View>("pace");
  const [withFixed, setWithFixed] = useState(false);
  const n = daily.days.length;
  const paceSeries = daily.variableTargetSource === "budget" ? PACE : PACE_AVG;

  const pacePoints: Point[] = daily.days.map((d, i) => {
    const day = i + 1;
    return {
      key: d.date,
      label: DAY_LABELS.has(day) ? String(day) : "",
      title: formatDayTitle(d.date),
      values: {
        cumulative: d.cumulativeVariable === null ? null : d.cumulativeVariable / 100,
        pace: daily.variableTargetSource === "none" ? null : (daily.variableTarget * day) / n / 100,
      },
    };
  });
  const dayPoints: Point[] = daily.days.map((d, i) => ({
    key: d.date,
    label: DAY_LABELS.has(i + 1) ? String(i + 1) : "",
    title: formatDayTitle(d.date),
    values: { amount: (d.variable + (withFixed ? d.fixed : 0)) / 100 },
  }));
  const weekPoints: Point[] = daily.weekdays.map((w) => ({
    key: String(w.weekday),
    label: w.label,
    title: ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"][w.weekday],
    values: { amount: w.average / 100 },
  }));
  const toDay = (p: Point) =>
    daily.days.find((d) => d.date === p.key)?.count ? (
      <a href={`/movimenti?giorno=${p.key}`} className="tooltip-link">
        Vedi i movimenti ›
      </a>
    ) : null;

  const lastCumulative = [...daily.days].reverse().find((d) => d.cumulativeVariable !== null)?.cumulativeVariable ?? 0;
  const dayIndex = daily.days.filter((d) => d.cumulativeVariable !== null).length;
  const paceToday = daily.variableTargetSource === "none" ? null : (daily.variableTarget * dayIndex) / n;

  return (
    <div className="card card-padded daily">
      {daily.today && <TodayCard today={daily.today} source={daily.variableTargetSource} />}
      <div className="segmented segmented-3" role="tablist" aria-label="Vista giornaliera">
        {(
          [
            ["pace", "Ritmo"],
            ["days", "Per giorno"],
            ["week", "Settimana"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? "selected" : ""} onClick={() => setView(k)}>
            {label}
          </button>
        ))}
      </div>

      {view === "pace" && (
        <div>
          <p className="muted small chart-sub">
            Spese variabili accumulate nel mese, senza affitto e abbonamenti
            {daily.variableTargetSource === "budget"
              ? ", rispetto al ritmo che ti porta esattamente al budget."
              : daily.variableTargetSource === "average"
                ? ", rispetto al tuo ritmo medio (imposta i budget per confrontarti con quelli)."
                : "."}
          </p>
          {paceToday !== null && dayIndex > 0 && (
            <p className={`pace-verdict ${lastCumulative > paceToday ? "pace-over" : "pace-ok"}`}>
              {lastCumulative > paceToday
                ? `${isCurrentMonth ? "Sei" : "Eri"} ${formatEuros(lastCumulative - paceToday)} sopra il ritmo`
                : `${isCurrentMonth ? "Sei" : "Eri"} ${formatEuros(paceToday - lastCumulative)} sotto il ritmo`}
            </p>
          )}
          <LineChart
            points={pacePoints}
            series={daily.variableTargetSource !== "none" ? [CUMULATIVE, paceSeries] : [CUMULATIVE]}
            formatTick={(v) => formatInt(v)}
            formatValue={(v) => formatCents(Math.round(v * 100))}
            ariaLabel="Spese variabili accumulate giorno per giorno rispetto al ritmo"
            tableCaption="Spese variabili accumulate per giorno"
            tableFirstColumn="Giorno"
            height={190}
          />
        </div>
      )}

      {view === "days" && (
        <div>
          <div className="chart-head">
            <p className="muted small chart-sub">Quanto hai speso ogni giorno. Tocca una colonna per i movimenti.</p>
            <label className="toggle small">
              <input type="checkbox" checked={withFixed} onChange={(e) => setWithFixed(e.target.checked)} />
              Con spese fisse
            </label>
          </div>
          <ColumnChart
            points={dayPoints}
            series={[PER_DAY]}
            formatTick={(v) => formatInt(v)}
            formatValue={(v) => formatCents(Math.round(v * 100))}
            tooltipExtra={toDay}
            ariaLabel="Spese per giorno del mese"
            tableCaption="Spese per giorno"
            tableFirstColumn="Giorno"
            height={190}
          />
        </div>
      )}

      {view === "week" && (
        <div>
          <p className="muted small chart-sub">Spesa variabile media per giorno della settimana, ultime 12 settimane.</p>
          <ColumnChart
            points={weekPoints}
            series={[PER_DAY]}
            formatTick={(v) => formatInt(v)}
            formatValue={(v) => formatCents(Math.round(v * 100))}
            ariaLabel="Spesa media per giorno della settimana"
            tableCaption="Spesa media per giorno della settimana"
            tableFirstColumn="Giorno"
            height={170}
          />
        </div>
      )}
    </div>
  );
}

function TodayCard({ today, source }: { today: NonNullable<Daily["today"]>; source: Daily["variableTargetSource"] }) {
  const over = today.perDayLeft !== null && today.spent > today.perDayLeft;
  return (
    <div className="today">
      <div className="today-main">
        <span className="muted small">Oggi</span>
        <strong className="today-value">{formatEuros(today.spent)}</strong>
        <span className="muted small">
          {today.count === 0 ? "nessun movimento" : today.count === 1 ? "1 movimento" : `${today.count} movimenti`}
          {today.averageDaily > 0 ? ` · media ${formatEuros(today.averageDaily)} al giorno` : ""}
        </span>
      </div>
      {today.perDayLeft !== null && (
        <div className={`today-left ${over ? "today-over" : ""}`}>
          <span className="small">{source === "budget" ? "Puoi spendere" : "Per restare nella media"}</span>
          <strong>{formatEuros(today.perDayLeft)}</strong>
          <span className="small">al giorno fino a fine mese</span>
        </div>
      )}
    </div>
  );
}
