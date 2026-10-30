import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { goalProgress, type Goal } from "@/lib/analytics/insights";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { GoalsManager } from "./GoalsManager";

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
  const goals = ((data ?? []) as Goal[]).map((g) => {
    const goal = { ...g, target_cents: Number(g.target_cents), saved_cents: Number(g.saved_cents) };
    return { goal, progress: goalProgress(goal, today) };
  });
  return (
    <main className="page">
      <PageHeader title="Obiettivi di risparmio" subtitle="Una cifra da mettere da parte entro una data: ti dico quanto serve al mese." />
      {error ? (
        <p className="alert">
          Non riesco a leggere gli obiettivi: {error.message}. Se è la prima volta, esegui su Supabase la migrazione{" "}
          <code>20261031000004_goals.sql</code>.
        </p>
      ) : (
        <GoalsManager goals={goals} today={today} />
      )}
    </main>
  );
}
