"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { monthOf } from "@/lib/analytics/dashboard";
import type { ProposalItem } from "@/lib/analytics/proposal";
import { romeDate } from "@/lib/entry/amount";
import { createClient } from "@/lib/supabase/server";

/** Applica una proposta dell'assistente: nuovi budget dal mese in corso (i mesi passati restano com'erano). */
export async function applyProposal(id: string): Promise<{ ok: boolean; error?: string; appliedAt?: string }> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("budget_proposals").select("items, applied_at").eq("id", id).single();
  if (error || !data) return { ok: false, error: error?.message ?? "Proposta non trovata" };
  if (data.applied_at) return { ok: true, appliedAt: data.applied_at };
  const validFrom = `${monthOf(romeDate())}-01`;
  const items = data.items as ProposalItem[];
  const up = await supabase
    .from("budgets")
    .upsert(items.map((i) => ({ category_id: i.category_id, valid_from: validFrom, amount_cents: i.to_cents })), { onConflict: "category_id,valid_from" });
  if (up.error) return { ok: false, error: up.error.message };
  const appliedAt = new Date().toISOString();
  await supabase.from("budget_proposals").update({ applied_at: appliedAt }).eq("id", id);
  revalidatePath("/");
  revalidatePath("/budget");
  return { ok: true, appliedAt };
}
