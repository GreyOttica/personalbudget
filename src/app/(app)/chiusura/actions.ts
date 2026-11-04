"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMissingObject } from "@/lib/supabase/missing";

/** Segna il mese come chiuso (si può rifare: aggiorna la data e la differenza di saldo). */
export async function closeMonth(month: string, balanceDiffCents: number | null): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: "Mese non valido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("month_closures")
    .upsert({ month, closed_at: new Date().toISOString(), balance_diff_cents: balanceDiffCents }, { onConflict: "month" });
  if (error) return { ok: false, error: isMissingObject(error) ? "Esegui prima su Supabase la migrazione 20261104000010_closing_tags.sql." : error.message };
  revalidatePath("/");
  revalidatePath("/chiusura");
  return { ok: true };
}
