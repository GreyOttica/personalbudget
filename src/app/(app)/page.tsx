import type { Metadata } from "next";
import Link from "next/link";
import { Meter, StatusLabel } from "@/components/Meter";
import { SyncBadge } from "@/components/SyncBadge";
import { addMonths, monthOf, type Dashboard } from "@/lib/analytics/dashboard";
import { loadDashboard, parseMonth } from "@/lib/analytics/load";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthName, formatPercent, formatProbability } from "@/lib/format";
import { categoryColorSlots, composition, smallSpends } from "@/lib/analytics/insights";
import { DailyFocus, TrendCharts } from "./DashboardCharts";
import { KIND_LABEL, periodLabel, type AnalysisRow } from "@/components/AnalysisCard";
import { createClient } from "@/lib/supabase/server";
import { budgetSignals, type BudgetSignal } from "@/lib/analytics/alerts";
import type { Accuracy, Prediction } from "@/lib/analytics/predict";
import { Composition, MonthFlow, SmallSpends, VersusUsual } from "./HomeInsights";

export const metadata: Metadata = { title: "Home" };

export default async function Home({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = parseMonth(m);
  const { dashboard: d, categories, subcategories, txns, prediction, accuracy } = await loadDashboard(month);
  const slots = categoryColorSlots(txns, month);
  const comp = composition(txns, categories, month, slots);
  const small = smallSpends(txns, categories, subcategories, month);
  const current = monthOf(romeDate());
  const monthName = formatMonthName(month);
  const empty = d.trend.length === 0;
  const signals = budgetSignals(d);
  const latestAi = month === current ? await latestAnalysis() : null;

  return (
    <main className="page dash">
      <header className="dash-top">
        <nav className="month-switch" aria-label="Cambia mese">
          <Link href={`/?m=${addMonths(month, -1)}`} className="month-arrow" aria-label="Mese precedente">
            ‹
          </Link>
          <h1>{formatMonth(`${month}-01`)}</h1>
          {month < current ? (
            <Link
              href={month === addMonths(current, -1) ? "/" : `/?m=${addMonths(month, 1)}`}
              className="month-arrow"
              aria-label="Mese successivo"
            >
              ›
            </Link>
          ) : (
            <span className="month-arrow disabled" aria-hidden>
              ›
            </span>
          )}
        </nav>
        <SyncBadge />
      </header>

      {empty ? (
        <section className="card card-padded">
          <h2>Benvenuto</h2>
          <p className="muted">
            Non ci sono ancora movimenti. Registra il primo con il <strong>+</strong> qui sotto, oppure importa lo storico da{" "}
            <Link href="/import">Altro → Import storico</Link>.
          </p>
        </section>
      ) : (
        <>
          <Hero d={d} monthName={monthName} p={prediction} accuracy={accuracy} />
          <Tiles d={d} />
          {signals.length > 0 && <Alerts signals={signals} />}
          {latestAi && <AiCard a={latestAi} />}
          <section className="section">
            <div className="section-head">
              <h2>Giorno per giorno</h2>
            </div>
            <DailyFocus daily={d.daily} isCurrentMonth={d.isCurrentMonth} quota={prediction?.quota ?? null} />
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
              <h2>Rispetto al solito</h2>
            </div>
            <VersusUsual rows={d.categories} isCurrentMonth={d.isCurrentMonth} months={d.averages.months} />
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
            Altre analisi in <Link href="/altro">Altro</Link>: anno, saldo del conto, categorie nel tempo, ricorrenti, viaggi e obiettivi.
          </p>
        </>
      )}
    </main>
  );
}

function budgetedForecastRatio(d: Dashboard): number | null {
  if (!d.forecast || !d.budget.total) return null;
  return d.categories.reduce((s, c) => s + (c.budget !== null ? (c.forecast ?? 0) : 0), 0) / d.budget.total;
}

const FORECAST_TEXT = { over: "Supererai il budget", warning: "Vicino al limite", ok: "In linea", none: undefined } as const;

function Hero({ d, monthName, p, accuracy }: { d: Dashboard; monthName: string; p: Prediction | null; accuracy: Accuracy | null }) {
  const { budget, forecast } = d;
  return (
    <section className="card hero">
      <p className="hero-label">Spese di {monthName}</p>
      <p className="hero-value">{formatEuros(d.totals.expense)}</p>
      {budget.total > 0 ? (
        <>
          <p className="muted">
            {budget.spent === d.totals.expense
              ? `su ${formatEuros(budget.total)} di budget · ${formatPercent(budget.ratio ?? 0)}`
              : `Categorie con budget: ${formatEuros(budget.spent)} su ${formatEuros(budget.total)} · ${formatPercent(budget.ratio ?? 0)}`}
          </p>
          <Meter
            ratio={budget.ratio ?? 0}
            status={budget.status}
            forecastRatio={budgetedForecastRatio(d)}
            label="Spese rispetto al budget del mese"
          />
        </>
      ) : (
        <p className="muted">
          Nessun budget impostato. <Link href="/budget">Imposta i budget</Link> per avvisi e confronti.
        </p>
      )}
      {forecast && (
        <>
          <div className="hero-forecast">
            <div>
              <span className="muted small">Stima a fine mese</span>
              <strong>{formatEuros(forecast.expense)}</strong>
              {p && p.expense.p90 - p.expense.p10 >= 1000 && (
                <span className="muted small">
                  probabilmente tra {formatEuros(p.expense.p10)} e {formatEuros(p.expense.p90)}
                </span>
              )}
            </div>
            <div className="hero-forecast-right">
              <span className="muted small">
                giorno {d.day} di {d.daysInMonth}
              </span>
              <StatusLabel status={d.budget.forecastStatus} text={FORECAST_TEXT[d.budget.forecastStatus]} />
            </div>
          </div>
          {p && (
            <div className="hero-savings">
              <span className="muted small">Risparmio previsto</span>
              <strong className={p.savings.p50 >= 0 ? undefined : "check-diff"}>{formatEuros(p.savings.p50)}</strong>
              <span className="muted small">
                tra {formatEuros(p.savings.p10)} e {formatEuros(p.savings.p90)}
                {p.usualSavings !== null && ` · di solito ${formatEuros(p.usualSavings)}`}
                {p.probAboveUsual !== null && ` · probabilità di fare meglio del solito: ${formatProbability(p.probAboveUsual)}`}
              </span>
            </div>
          )}
          <p className="muted small hero-note">
            Fisse {formatEuros(forecast.fixed)} (ricorrenti o, se mancano, come il mese scorso). Variabili{" "}
            {formatEuros(forecast.variable)}: {p ? `simulazione su ${p.historyDays} giorni del tuo storico, con più peso ai giorni recenti e al giorno della settimana` : "ritmo attuale corretto con la tua media"}.
            {accuracy?.error != null && accuracy.months >= 2 && ` Verificata sugli ultimi ${accuracy.months} mesi: a metà mese sbaglia in media del ${Math.round(accuracy.error * 100)}%.`}
          </p>
        </>
      )}
    </section>
  );
}

function Delta({ value, unit, goodWhenUp }: { value: number; unit: "pt" | "€"; goodWhenUp: boolean }) {
  if (Math.abs(value) < (unit === "pt" ? 0.5 : 100)) return <span className="delta">in linea con la media</span>;
  const up = value > 0;
  const good = up === goodWhenUp;
  const text =
    unit === "pt"
      ? `${up ? "+" : "−"}${Math.abs(value).toFixed(1).replace(".", ",")} pt`
      : `${up ? "+" : "−"}${formatEuros(Math.abs(value))}`;
  return (
    <span className={`delta ${good ? "delta-good" : "delta-bad"}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span> {text} vs media
    </span>
  );
}

function Tiles({ d }: { d: Dashboard }) {
  const avg = d.averages;
  const rate = d.forecast?.savingsRate ?? d.totals.savingsRate;
  return (
    <section className="tiles">
      <div className="tile">
        <span className="tile-label">Entrate</span>
        <span className="tile-value">{formatEuros(d.totals.income)}</span>
        {avg.months > 0 && <Delta value={d.totals.income - avg.income} unit="€" goodWhenUp />}
      </div>
      <div className="tile">
        <span className="tile-label">Investito</span>
        <span className="tile-value">{formatEuros(d.totals.investment)}</span>
        <span className="delta">conta come risparmio</span>
      </div>
      <div className="tile">
        <span className="tile-label">{d.forecast ? "Risparmio stimato" : "Risparmio"}</span>
        <span className="tile-value">{rate === null ? "—" : formatPercent(rate)}</span>
        {rate !== null && avg.savingsRate !== null && <Delta value={(rate - avg.savingsRate) * 100} unit="pt" goodWhenUp />}
      </div>
    </section>
  );
}

const MAX_ALERTS = 3;

function Alerts({ signals }: { signals: BudgetSignal[] }) {
  // budgetSignals: prima i superati, poi oltre l'80%, poi le proiezioni; ciascun gruppo per sforamento.
  const shown = signals.slice(0, MAX_ALERTS);
  const hidden = signals.length - shown.length;
  return (
    <section className="card alerts" aria-label="Avvisi budget">
      {shown.map((a) => (
        <div key={a.key} className={`alert-row${a.level === "projection" ? " alert-projection" : ""}`}>
          <span className="cat-emoji" aria-hidden>
            {a.emoji}
          </span>
          <div className="alert-main">
            <strong>{a.name}</strong>
            <span className="muted small">
              {a.level === "projection"
                ? `al ritmo attuale ${formatEuros(a.forecast ?? a.spent)} su ${formatEuros(a.budget)} · +${formatEuros((a.forecast ?? a.spent) - a.budget)}${a.probOver != null ? ` · probabilità ${formatProbability(a.probOver)}` : ""}${a.perDayLeft !== null ? ` · ${formatEuros(a.perDayLeft)}/giorno per restare nel budget` : ""}`
                : `${formatEuros(a.spent)} su ${formatEuros(a.budget)}${a.level === "over" ? ` · +${formatEuros(a.spent - a.budget)}` : ` · ${formatPercent(a.spent / a.budget)}`}`}
            </span>
          </div>
          <StatusLabel status={a.level === "over" ? "over" : "warning"} text={a.level === "over" ? "Superato" : a.level === "warning" ? "Oltre l'80%" : "Sforerai"} />
        </div>
      ))}
      {hidden > 0 && (
        <Link href="/budget" className="alerts-more small">
          e {hidden === 1 ? "un altro avviso" : `altri ${hidden} avvisi`} ›
        </Link>
      )}
    </section>
  );
}

/** Ultima analisi AI (se la migrazione 0006 manca, la card semplicemente non compare). */
async function latestAnalysis() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("analyses")
    .select("kind, period_start, period_end, headline, content")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Pick<AnalysisRow, "kind" | "period_start" | "period_end" | "headline" | "content"> | null) ?? null;
}

function AiCard({ a }: { a: Pick<AnalysisRow, "kind" | "period_start" | "period_end" | "headline" | "content"> }) {
  const tip = a.content.consigli[0];
  return (
    <Link href="/analisi" className="card card-padded home-ai">
      <span className="analysis-kind">
        <span>🧠 {KIND_LABEL[a.kind]}</span>
        <span className="muted small">{periodLabel(a)} ›</span>
      </span>
      <strong>{a.headline}</strong>
      {tip && (
        <span className="muted small">
          {tip.titolo}: fino a {formatEuros(tip.euro_mese * 100)} al mese
        </span>
      )}
    </Link>
  );
}
