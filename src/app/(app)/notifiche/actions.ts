"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { romeDate } from "@/lib/entry/amount";
import { runBackup } from "@/lib/notify/backup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SETTING_KEYS, type SettingKey } from "./keys";


export async function saveSetting(key: SettingKey, value: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, error: "Sessione scaduta: esci e rientra." };
  }
  if (!SETTING_KEYS.includes(key) || typeof value !== "boolean") return { ok: false, error: "Impostazione non valida" };
  const supabase = await createClient();
  const { error } = await supabase.from("notification_settings").update({ [key]: value, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifiche");
  return { ok: true };
}

export async function backupNow(): Promise<{ ok: boolean; message: string }> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, message: "Sessione scaduta: esci e rientra." };
  }
  try {
    const b = await runBackup(createAdminClient(), romeDate());
    revalidatePath("/notifiche");
    return { ok: true, message: `Backup salvato: ${b.rows} righe.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
