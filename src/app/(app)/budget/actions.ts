"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { monthOf } from "@/lib/analytics/dashboard";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";

export type SaveBudgetsResult = { ok: true } | { ok: false; error: string };

/**
 * Salva i budget dal mese in corso in poi (i mesi passati restano con i budget
 * che avevano). Un importo 0 significa "nessun budget".
 */
export async function saveBudgets(entries: { categoryId: string; cents: number }[]): Promise<SaveBudgetsResult> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  if (!Array.isArray(entries) || entries.some((e) => !Number.isInteger(e.cents) || e.cents < 0 || e.cents > 10_000_000_00)) {
    return { ok: false, error: "Importi non validi." };
  }
  const validFrom = `${monthOf(romeDate())}-01`;
  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .upsert(
      entries.map((e) => ({ category_id: e.categoryId, valid_from: validFrom, amount_cents: e.cents })),
      { onConflict: "category_id,valid_from" },
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  revalidatePath("/budget");
  return { ok: true };
}
