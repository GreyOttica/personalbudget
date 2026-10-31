import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { nextOccurrence, recurring } from "@/lib/analytics/insights";
import { loadAll } from "@/lib/analytics/loadAll";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
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
  return (
    <main className="page">
      <PageHeader title="Ricorrenti" subtitle="Affitto, abbonamenti, versamenti: il giorno giusto l'app li registra da sola." />
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
