"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type GoalResult = { ok: true } | { ok: false; error: string };

const MAX = 10_000_000_00;
const validCents = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX;

async function guard(): Promise<GoalResult | null> {
  try {
    await requireOwner();
    return null;
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
}

export async function saveGoal(input: { id?: string; name: string; emoji: string; targetCents: number; targetDate: string | null }): Promise<GoalResult> {
  const denied = await guard();
  if (denied) return denied;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Dai un nome all'obiettivo." };
  if (!validCents(input.targetCents) || input.targetCents === 0) return { ok: false, error: "Importo non valido." };
  if (input.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate)) return { ok: false, error: "Data non valida." };
  const supabase = await createClient();
  const row = { name, emoji: input.emoji || "🎯", target_cents: input.targetCents, target_date: input.targetDate || null };
  const { error } = input.id ? await supabase.from("goals").update(row).eq("id", input.id) : await supabase.from("goals").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/obiettivi");
  return { ok: true };
}

/** Aggiunge (o toglie, con un importo negativo) quanto hai messo da parte. */
export async function addToGoal(id: string, deltaCents: number): Promise<GoalResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!Number.isInteger(deltaCents) || Math.abs(deltaCents) > MAX) return { ok: false, error: "Importo non valido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("goals").select("saved_cents").eq("id", id).single();
  if (error || !data) return { ok: false, error: error?.message ?? "Obiettivo non trovato." };
  const saved = Math.max(0, Number(data.saved_cents) + deltaCents);
  const { error: e2 } = await supabase.from("goals").update({ saved_cents: saved }).eq("id", id);
  if (e2) return { ok: false, error: e2.message };
  revalidatePath("/obiettivi");
  return { ok: true };
}

export async function archiveGoal(id: string): Promise<GoalResult> {
  const denied = await guard();
  if (denied) return denied;
  const supabase = await createClient();
  const { error } = await supabase.from("goals").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/obiettivi");
  return { ok: true };
}
