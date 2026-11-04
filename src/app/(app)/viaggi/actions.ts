"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMissingObject } from "@/lib/supabase/missing";

export type TagBudgetResult = { ok: true } | { ok: false; error: string };

async function guard(): Promise<TagBudgetResult | null> {
  try {
    await requireOwner();
    return null;
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
}
const missing = (e: { code?: string; message: string }) =>
  isMissingObject(e) ? "Esegui prima su Supabase la migrazione 20261104000010_closing_tags.sql." : e.message;

/** Budget per un tag: crea o sostituisce. */
export async function saveTagBudget(tag: string, amountCents: number, endsOn: string | null): Promise<TagBudgetResult> {
  const denied = await guard();
  if (denied) return denied;
  const name = tag.trim();
  if (!name || name.length > 80) return { ok: false, error: "Scrivi il nome del viaggio o dell'evento." };
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10_000_000_00) return { ok: false, error: "Importo non valido." };
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { ok: false, error: "Data non valida." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tag_budgets")
    .upsert({ tag: name, amount_cents: amountCents, ends_on: endsOn || null, updated_at: new Date().toISOString() }, { onConflict: "tag" });
  if (error) return { ok: false, error: missing(error) };
  revalidatePath("/viaggi");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteTagBudget(tag: string): Promise<TagBudgetResult> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("tag_budgets").delete().eq("tag", tag);
  if (error) return { ok: false, error: missing(error) };
  revalidatePath("/viaggi");
  revalidatePath("/");
  return { ok: true };
}
