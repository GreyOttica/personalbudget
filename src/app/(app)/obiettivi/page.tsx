import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { goalProgress, type Goal } from "@/lib/analytics/insights";
import { romeDate } from "@/lib/entry/amount";
import { isMissingObject } from "@/lib/supabase/missing";
import { createClient } from "@/lib/supabase/server";
import { GoalsManager } from "./GoalsManager";
import { monthOf } from "@/lib/analytics/dashboard";
import { loadDashboard } from "@/lib/analytics/load";
import { goalForecasts } from "@/lib/analytics/predict";
import { formatEuros, formatProbability } from "@/lib/format";

export const metadata: Metadata = { title: "Obiettivi di risparmio" };

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("id, name, emoji, target_cents, saved_cents, target_date")
    .is("archived_at", null)
    .order("target_date", { ascending: true, nullsFirst: false })
    .order("created_at");
  const today = romeDate();
  const list = ((data ?? []) as Goal[]).map((g) => ({ ...g, target_cents: Number(g.target_cents), saved_cents: Number(g.saved_cents) }));
  // Previsione del mese: quanto risparmi di solito (per l'arrivo previsto) e se il mese copre le quote.
  const { prediction } = list.length && !error ? await loadDashboard(monthOf(today)) : { prediction: null };
  const forecasts = new Map(goalForecasts(list, today, prediction?.usualSavings ?? null, prediction?.savings.p50 ?? null).map((f) => [f.id, f]));
  const goals = list.map((goal) => ({ goal, progress: goalProgress(goal, today), forecast: forecasts.get(goal.id) }));
  return (
    <main className="page">
      <PageHeader title="Obiettivi di risparmio" subtitle="Una cifra da mettere da parte entro una data: ti dico quanto serve al mese." />
      {error ? (
        isMissingObject(error) ? (
          <section className="card card-padded">
            <p>
              <strong>Manca la tabella degli obiettivi su Supabase.</strong> Esegui una volta la migrazione{" "}
              <code>20261031000004_goals.sql</code>:
            </p>
            <ol className="small notif-steps">
              <li>
                Apri il file su{" "}
                <a href="https://github.com/GreyOttica/personalbudget/blob/main/supabase/migrations/20261031000004_goals.sql" target="_blank" rel="noreferrer">
                  GitHub
                </a>{" "}
                e copia tutto il testo (icona «Copy raw file»).
              </li>
              <li>Su Supabase: SQL Editor → New query → incolla → Run.</li>
              <li>Torna qui e ricarica la pagina.</li>
            </ol>
          </section>
        ) : (
          <p className="alert">Non riesco a leggere gli obiettivi: {error.message}</p>
        )
      ) : (
        <>
          {prediction && prediction.goalsNeed > 0 && (
            <section className="card card-padded goals-month">
              <div className="cost-row">
                <span>Questo mese gli obiettivi chiedono</span>
                <strong>{formatEuros(prediction.goalsNeed)}</strong>
              </div>
              <p className="small">
                Risparmio previsto {formatEuros(prediction.savings.p50)} (tra {formatEuros(prediction.savings.p10)} e{" "}
                {formatEuros(prediction.savings.p90)}): probabilità di coprire le quote{" "}
                <strong className={prediction.probGoals !== null && prediction.probGoals < 0.5 ? "check-diff" : "good-text"}>
                  {formatProbability(prediction.probGoals ?? 0)}
                </strong>
                .
              </p>
              {prediction.targetSource === "goals" && (
                <p className="muted small">Le quote superano il tuo obiettivo di risparmio: la quota di spesa giornaliera in Home parte da queste.</p>
              )}
            </section>
          )}
          <GoalsManager goals={goals} today={today} />
        </>
      )}
    </main>
  );
}
