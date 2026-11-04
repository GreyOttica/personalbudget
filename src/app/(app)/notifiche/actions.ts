"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { romeDate } from "@/lib/entry/amount";
import { describeBackup, readBackup, runBackup, type BackupFile } from "@/lib/notify/backup";
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
    // Con l'ora nel nome: un backup fatto a mano non sovrascrive mai quello della settimana.
    const hm = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(":", "");
    const b = await runBackup(createAdminClient(), romeDate(), `-ore-${hm}`);
    revalidatePath("/notifiche");
    return { ok: true, message: `Backup salvato: ${b.rows} righe.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export type BackupInfo = { ok: true; createdAt: string; rows: Record<string, number> } | { ok: false; message: string };

/** Anteprima di un backup salvato (per la conferma prima del ripristino). */
export async function previewBackup(name: string): Promise<BackupInfo> {
  try {
    await requireOwner();
    return { ok: true, ...describeBackup(await readBackup(createAdminClient(), name)) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Ripristina un backup (dallo Storage per nome, oppure il testo di un file caricato).
 * Prima salva un backup dello stato attuale, così il ripristino si può annullare.
 */
export async function restoreBackup(source: { name: string } | { json: string }): Promise<{ ok: boolean; message: string }> {
  try {
    await requireOwner();
  } catch {
    return { ok: false, message: "Sessione scaduta: esci e rientra." };
  }
  try {
    const admin = createAdminClient();
    const backup: BackupFile = "name" in source ? await readBackup(admin, source.name) : (JSON.parse(source.json) as BackupFile);
    describeBackup(backup); // controlla che sia un nostro backup
    const before = await runBackup(admin, romeDate(), `-prima-del-ripristino-${Date.now().toString(36)}`);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_backup", { p: backup });
    if (error) {
      const missing = /restore_backup|could not find the function/i.test(error.message);
      return { ok: false, message: missing ? "Esegui prima su Supabase la migrazione 20261104000010_closing_tags.sql." : `Ripristino annullato, nessun dato cambiato: ${error.message}` };
    }
    for (const p of ["/", "/movimenti", "/budget", "/ricorrenti", "/obiettivi", "/saldo", "/notifiche"]) revalidatePath(p);
    const n = (data as { transactions?: number } | null)?.transactions ?? 0;
    return { ok: true, message: `Ripristinato: ${n} movimenti. Lo stato di prima è salvato in ${before.file}, per tornare indietro.` };
  } catch (e) {
    return { ok: false, message: e instanceof SyntaxError ? "Il file non è un JSON valido." : e instanceof Error ? e.message : String(e) };
  }
}
