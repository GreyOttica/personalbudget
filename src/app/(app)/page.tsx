import type { Metadata } from "next";
import Link from "next/link";
import { Meter, StatusLabel } from "@/components/Meter";
import { SyncBadge } from "@/components/SyncBadge";
import { addMonths, monthOf, type Dashboard } from "@/lib/analytics/dashboard";
import { loadDashboard, parseMonth } from "@/lib/analytics/load";
import { romeDate } from "@/lib/entry/amount";
import { formatEuros, formatMonth, formatMonthName, formatPercent } from "@/lib/format";
import { DailyFocus, SubcategoryBreakdown, TrendCharts } from "./DashboardCharts";

export const metadata: Metadata = { title: "Home" };

export default async function Home({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const month = parseMonth(m);
  const { dashboard: d } = await loadDashboard(month);
  const current = monthOf(romeDate());
  const monthName = formatMonthName(month);
  const empty = d.trend.length === 0;

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
          <Hero d={d} monthName={monthName} />
          <Tiles d={d} />
          {d.alerts.length > 0 && <Alerts d={d} />}
          <section className="section">
            <div className="section-head">
              <h2>Giorno per giorno</h2>
            </div>
            <DailyFocus daily={d.daily} isCurrentMonth={d.isCurrentMonth} />
          </section>
          <CategoryBudgets d={d} />
          <section className="section">
            <div className="section-head">
              <h2>Andamento</h2>
              <span className="muted small">ultimi {d.trend.length} mesi</span>
            </div>
            <TrendCharts trend={d.trend} selected={month} />
          </section>
          <section className="section">
            <div className="section-head">
              <h2>Spese per sottocategoria</h2>
              <span className="muted small">{monthName}</span>
            </div>
            <SubcategoryBreakdown rows={d.subcategories} />
          </section>
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

function Hero({ d, monthName }: { d: Dashboard; monthName: string }) {
  const { budget, forecast } = d;
  return (
    <section className="card hero">
      <p className="hero-label">Spese di {monthName}</p>
      <p className="hero-value">{formatEuros(d.totals.expense)}</p>
      {budget.total > 0 ? (
        <>
          <p className="muted">
            su {formatEuros(budget.total)} di budget · {formatPercent(budget.ratio ?? 0)}
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
            </div>
            <div className="hero-forecast-right">
              <span className="muted small">
                giorno {d.day} di {d.daysInMonth}
              </span>
              <StatusLabel status={d.budget.forecastStatus} text={FORECAST_TEXT[d.budget.forecastStatus]} />
            </div>
          </div>
          <p className="muted small hero-note">
            Fisse {formatEuros(forecast.fixed)} (come il mese scorso, non proiettate) + variabili {formatEuros(forecast.variable)}{" "}
            (ritmo attuale corretto con la tua media).
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

function Alerts({ d }: { d: Dashboard }) {
  // Prima i budget superati (per quanto sforano), poi quelli oltre l'80%.
  const sorted = [...d.alerts].sort(
    (a, b) =>
      (a.status === "over" ? 0 : 1) - (b.status === "over" ? 0 : 1) ||
      b.spent - (b.budget ?? 0) - (a.spent - (a.budget ?? 0)) ||
      (b.ratio ?? 0) - (a.ratio ?? 0),
  );
  const shown = sorted.slice(0, MAX_ALERTS);
  const hidden = sorted.length - shown.length;
  return (
    <section className="card alerts" aria-label="Avvisi budget">
      {shown.map((a) => (
        <div key={a.id} className="alert-row">
          <span className="cat-emoji" aria-hidden>
            {a.emoji}
          </span>
          <div className="alert-main">
            <strong>{a.name}</strong>
            <span className="muted small">
              {formatEuros(a.spent)} su {formatEuros(a.budget ?? 0)}
              {a.status === "over" ? ` · +${formatEuros(a.spent - (a.budget ?? 0))}` : ` · ${formatPercent(a.ratio ?? 0)}`}
            </span>
          </div>
          <StatusLabel status={a.status} text={a.status === "over" ? "Superato" : "Oltre l'80%"} />
        </div>
      ))}
      {hidden > 0 && (
        <a href="#budget-categorie" className="alerts-more small">
          e {hidden === 1 ? "un altro avviso" : `altri ${hidden} avvisi`} ›
        </a>
      )}
    </section>
  );
}

function CategoryRowItem({ c, showAverage }: { c: Dashboard["categories"][number]; showAverage: boolean }) {
  return (
    <li className="cat-row">
      <span className="cat-emoji" aria-hidden>
        {c.emoji}
      </span>
      <div className="cat-main">
        <div className="cat-line">
          <span className="cat-name">
            {c.name}
            {c.isFixed && <span className="pill">fissa</span>}
          </span>
          <span className="cat-amount">
            {formatEuros(c.spent)}
            {c.budget !== null && <span className="muted"> / {formatEuros(c.budget)}</span>}
          </span>
        </div>
        {c.budget !== null && (
          <Meter
            ratio={c.ratio ?? 0}
            status={c.status}
            forecastRatio={c.forecast !== null ? c.forecast / c.budget : null}
            label={`${c.name}: ${formatPercent(c.ratio ?? 0)} del budget`}
          />
        )}
        <div className="cat-sub muted small">
          {c.budget !== null && c.status !== "ok" && <StatusLabel status={c.status} />}
          {c.forecast !== null && c.forecast > c.spent && <span>stima {formatEuros(c.forecast)}</span>}
          {showAverage && <span>media {formatEuros(c.average)}</span>}
        </div>
      </div>
    </li>
  );
}

function CategoryBudgets({ d }: { d: Dashboard }) {
  // In vista le categorie con spese nel mese; le altre (budget ancora intatto) a richiesta.
  const active = d.categories.filter((c) => c.spent > 0);
  const quiet = d.categories.filter((c) => c.spent === 0 && c.budget !== null);
  const showAverage = d.averages.months > 0;
  return (
    <section className="section" id="budget-categorie">
      <div className="section-head">
        <h2>Budget per categoria</h2>
        <Link href="/budget" className="small">
          Modifica
        </Link>
      </div>
      {active.length === 0 ? (
        <p className="muted">Nessuna spesa in questo mese.</p>
      ) : (
        <ul className="card cat-list">
          {active.map((c) => (
            <CategoryRowItem key={c.id} c={c} showAverage={showAverage} />
          ))}
        </ul>
      )}
      {quiet.length > 0 && (
        <details className="more-cats">
          <summary>
            {quiet.length === 1 ? "Un'altra categoria" : `Altre ${quiet.length} categorie`} senza spese questo mese
          </summary>
          <ul className="card cat-list">
            {quiet.map((c) => (
              <CategoryRowItem key={c.id} c={c} showAverage={showAverage} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
