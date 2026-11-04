import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { nextOccurrence, recurring } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatEuros } from "@/lib/format";
import { RecurringManager } from "./RecurringManager";

export const metadata: Metadata = { title: "Ricorrenti e abbonamenti" };

export default async function RecurringPage() {
  const { txns, categories, subcategories, rules } = await loadAll();
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("accounts").select("id, name").eq("is_active", true).order("name");
  const today = romeDate();
  // Riconosciuti nello storico ma non ancora automatici.
  const covered = new Set(rules.map((r) => `${r.category_id}|${r.subcategory_id ?? ""}`));
  const detected = recurring(txns, categories, subcategories, today).filter((d) => !covered.has(`${d.categoryId}|${d.subcategoryId ?? ""}`));
  // Quanto pesano in tutto: ricorrenti automatici di spesa + quelli riconosciuti nello storico.
  const autoMonthly = rules.filter((r) => r.active && r.type === "expense").reduce((s, r) => s + r.amount_cents, 0);
  const detectedMonthly = detected.reduce((s, d) => s + d.typical, 0);
  const monthly = autoMonthly + detectedMonthly;
  const increased = recurring(txns, categories, subcategories, today).filter((d) => d.changed && d.previous !== null && d.last > d.previous && d.last - d.previous <= d.previous * 0.35);
  return (
    <main className="page">
      <PageHeader title="Ricorrenti" subtitle="Affitto, abbonamenti, versamenti: il giorno giusto l'app li registra da sola." />
      {monthly > 0 && (
        <section className="card card-padded subs-summary">
          <div className="cost-row">
            <span>Spese ricorrenti</span>
            <strong>
              {formatEuros(monthly)} <span className="muted small">al mese</span>
            </strong>
          </div>
          <p className="muted small">
            {formatEuros(monthly * 12)} l&apos;anno: {formatEuros(autoMonthly)} automatiche e {formatEuros(detectedMonthly)} riconosciute nello storico. Ogni
            abbonamento che togli vale 12 volte il suo prezzo: li usi ancora tutti?
          </p>
          {increased.length > 0 && (
            <ul className="subs-up">
              {increased.map((d) => (
                <li key={`${d.categoryId}|${d.subcategoryId ?? ""}`} className="check-diff small">
                  ▲ {d.emoji} {d.name}: da {formatCents(d.previous!)} a {formatCents(d.last)} (+{formatEuros((d.last - d.previous!) * 12)} l&apos;anno)
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <RecurringManager
        today={today}
        rules={rules.map((r) => ({ ...r, next: nextOccurrence(r, today) }))}
        detected={detected}
        categories={categories}
        subcategories={subcategories}
        accounts={accounts ?? []}
      />
    </main>
  );
}
