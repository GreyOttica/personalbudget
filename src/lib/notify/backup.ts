import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
const BUCKET = "backups";
const KEEP = 8; // circa due mesi di backup settimanali
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

async function dump(admin: Admin, table: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select("*").range(from, from + 999);
    if (error) {
      if (/does not exist|could not find the table/i.test(error.message)) return rows; // migrazione non eseguita
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

/** Copia completa dei dati in JSON nello Storage di Supabase (cartella privata "backups"). */
export async function runBackup(admin: Admin, date: string) {
  const tables: Record<string, unknown[]> = {};
  let rows = 0;
  for (const t of TABLES) {
    tables[t] = await dump(admin, t);
    rows += tables[t].length;
  }
  const file = `backup-${date}.json`;
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
