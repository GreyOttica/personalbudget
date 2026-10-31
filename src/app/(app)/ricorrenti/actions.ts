"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";
import { isMissingObject } from "@/lib/supabase/missing";

export type RuleInput = {
  id?: string;
  name: string;
  type: "expense" | "income" | "investment";
  amountCents: number;
  categoryId: string;
  subcategoryId: string | null;
  accountId: string | null;
  dayOfMonth: number;
  startsOn: string;
  active: boolean;
};
export type RuleResult = { ok: true; created: number } | { ok: false; error: string };

async function guard() {
  try {
    await requireOwner();
    return null;
  } catch {
    return { ok: false as const, error: "Sessione scaduta: esci e rientra." };
  }
}

function refresh() {
  for (const p of ["/ricorrenti", "/", "/budget", "/movimenti", "/saldo"]) revalidatePath(p);
}

/** Salva un ricorrente e crea subito gli addebiti già dovuti (per esempio se parte da oggi). */
export async function saveRule(input: RuleInput): Promise<RuleResult> {
  const denied = await guard();
  if (denied) return denied;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Dai un nome al ricorrente." };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 10_000_000_00) return { ok: false, error: "Importo non valido." };
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) return { ok: false, error: "Il giorno va da 1 a 31." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)) return { ok: false, error: "Data di inizio non valida." };
  if (!["expense", "income", "investment"].includes(input.type)) return { ok: false, error: "Tipo non valido." };

  const supabase = await createClient();
  // Riattivando un ricorrente in pausa si riparte dal mese in corso: niente addebiti per i mesi di pausa.
  let startsOn = input.startsOn;
  if (input.id && input.active) {
    const { data: prev } = await supabase.from("recurring_rules").select("active").eq("id", input.id).maybeSingle();
    const monthStart = `${romeDate().slice(0, 7)}-01`;
    if (prev && !prev.active && startsOn < monthStart) startsOn = monthStart;
  }
  const row = {
    name,
    type: input.type,
    amount_cents: input.amountCents,
    category_id: input.categoryId,
    subcategory_id: input.subcategoryId,
    account_id: input.accountId,
    day_of_month: input.dayOfMonth,
    starts_on: startsOn,
    active: input.active,
  };
  const { error } = input.id
    ? await supabase.from("recurring_rules").update(row).eq("id", input.id)
    : await supabase.from("recurring_rules").insert(row);
  if (error) {
    const missing = isMissingObject(error);
    return { ok: false, error: missing ? "Esegui prima su Supabase la migrazione 20261101000005_recurring_balance.sql." : error.message };
  }
  const { data: created } = await supabase.rpc("generate_recurring", { p_today: romeDate() });
  refresh();
  return { ok: true, created: Number(created ?? 0) };
}

/** Elimina la regola: i movimenti già creati restano. */
export async function deleteRule(id: string): Promise<RuleResult> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("recurring_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, created: 0 };
}
