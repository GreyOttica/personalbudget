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

/** Obiettivo di risparmio mensile (centesimi); null = "come di solito". */
export async function saveSavingsTarget(cents: number | null): Promise<SaveBudgetsResult> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  if (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > 10_000_000_00)) return { ok: false, error: "Importo non valido." };
  const supabase = await createClient();
  const { error } = await supabase.from("preferences").update({ savings_target_cents: cents, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return { ok: false, error: /preferences|does not exist|could not find/i.test(error.message) ? "Esegui prima su Supabase la migrazione 20261104000009_predictions.sql." : error.message };
  revalidatePath("/");
  revalidatePath("/budget");
  return { ok: true };
}
