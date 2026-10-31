"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";

export type CheckpointResult = { ok: true } | { ok: false; error: string };

/** Salva il saldo reale del conto a fine giornata di una data (sostituisce un saldo già inserito per quel giorno). */
export async function saveCheckpoint(asOf: string, balanceCents: number): Promise<CheckpointResult> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf > romeDate()) return { ok: false, error: "Scegli una data di oggi o passata." };
  if (!Number.isInteger(balanceCents) || Math.abs(balanceCents) > 10_000_000_00) return { ok: false, error: "Importo non valido." };
  const supabase = await createClient();
  const { data: account } = await supabase.from("accounts").select("id").eq("is_active", true).order("name").limit(1).maybeSingle();
  await supabase.from("balance_checkpoints").delete().eq("as_of", asOf);
  const { error } = await supabase.from("balance_checkpoints").insert({ as_of: asOf, balance_cents: balanceCents, account_id: account?.id ?? null });
  if (error) {
    const missing = /balance_checkpoints|does not exist|schema cache/i.test(error.message);
    return { ok: false, error: missing ? "Esegui prima su Supabase la migrazione 20261101000005_recurring_balance.sql." : error.message };
  }
  revalidatePath("/saldo");
  return { ok: true };
}

export async function deleteCheckpoint(id: string): Promise<CheckpointResult> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("balance_checkpoints").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/saldo");
  return { ok: true };
}
