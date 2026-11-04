import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
const BUCKET = "backups";
const KEEP = 12; // circa due mesi di backup settimanali, più quelli fatti a mano
const TABLES = [
  "accounts",
  "categories",
  "subcategories",
  "transactions",
  "budgets",
  "recurring_rules",
  "balance_checkpoints",
  "goals",
  "notification_settings",
] as const;

/** Ordine stabile per leggere a pagine senza saltare o ripetere righe. */
const ORDER: Record<string, string[]> = { budgets: ["category_id", "valid_from"], notification_settings: [] };

async function dump(admin: Admin, table: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select("*");
    for (const col of ORDER[table] ?? ["id"]) q = q.order(col);
    const { data, error } = await q.range(from, from + 999);
    if (error) {
      if (/does not exist|could not find the table/i.test(error.message)) return rows; // migrazione non eseguita
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** Copia completa dei dati in JSON nello Storage di Supabase (cartella privata "backups"). */
export async function runBackup(admin: Admin, date: string, suffix = "") {
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of TABLES) {
    tables[t] = await dump(admin, t);
    rows += tables[t].length;
  }
  const file = `backup-${date}${suffix}.json`;
  const body = JSON.stringify({ app: "personal-budget", version: 1, created_at: new Date().toISOString(), tables });
  const { error } = await admin.storage.from(BUCKET).upload(file, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`Storage: ${error.message}`);
  const { data: list } = await admin.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  const old = (list ?? []).filter((f) => f.name.startsWith("backup-")).slice(KEEP).map((f) => f.name);
  if (old.length) await admin.storage.from(BUCKET).remove(old);
  return { file, rows, bytes: body.length };
}

export async function listBackups(admin: Admin) {
  const { data, error } = await admin.storage.from(BUCKET).list("", { limit: 20, sortBy: { column: "name", order: "desc" } });
  if (error || !data) return [];
  const files = data.filter((f) => f.name.startsWith("backup-"));
  const signed = await Promise.all(files.map((f) => admin.storage.from(BUCKET).createSignedUrl(f.name, 3600, { download: true })));
  return files.map((f, i) => ({ name: f.name, size: (f.metadata as { size?: number } | null)?.size ?? null, url: signed[i].data?.signedUrl ?? null }));
}

export type BackupFile = { app: string; version: number; created_at: string; tables: Record<string, unknown[]> };

/** Legge un backup dallo Storage. */
export async function readBackup(admin: Admin, name: string): Promise<BackupFile> {
  if (!/^backup-[\w-]+\.json$/.test(name)) throw new Error("Nome del backup non valido");
  const { data, error } = await admin.storage.from(BUCKET).download(name);
  if (error || !data) throw new Error(`Backup non trovato: ${error?.message ?? name}`);
  return JSON.parse(await data.text()) as BackupFile;
}

/** Riepilogo di un backup: data e righe per tabella. */
export function describeBackup(b: BackupFile) {
  if (b?.app !== "personal-budget" || !b.tables || typeof b.tables !== "object") throw new Error("Il file non è un backup di questa app.");
  const rows = Object.fromEntries(Object.entries(b.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  return { createdAt: b.created_at, rows };
}
