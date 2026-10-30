"use server";

import { requireOwner } from "@/lib/auth";
import {
  buildReport,
  compareWithDb,
  type DbMonth,
  type ImportReport,
  type ImportStats,
} from "@/lib/import/sheet";
import { createAdminClient } from "@/lib/supabase/admin";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "done";
      mode: "preview" | "import";
      fileName: string;
      report: Omit<ImportReport, "rows"> & { rowCount: number };
      stats?: ImportStats;
      dbMismatches?: string[];
    };

const MAX_BYTES = 4 * 1024 * 1024;

export async function runImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  try {
    await requireOwner();
  } catch {
    return { status: "error", message: "Sessione scaduta: esci e rientra." };
  }

  const mode = formData.get("mode") === "import" ? "import" : "preview";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Scegli il file Excel." };
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", message: "Il file deve essere in formato .xlsx (Google Sheets → File → Scarica → Microsoft Excel)." };
  }
  if (file.size > MAX_BYTES) return { status: "error", message: "Il file supera i 4 MB." };

  let report: ImportReport;
  try {
    report = buildReport(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { status: "error", message: `Non riesco a leggere il file: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { rows, ...summary } = report;
  const result: ImportState = {
    status: "done",
    mode,
    fileName: file.name,
    report: { ...summary, rowCount: rows.length },
  };
  if (mode === "preview") return result;

  const admin = createAdminClient();
  const { data: stats, error } = await admin.rpc("import_sheet_rows", { p_rows: rows });
  if (error) return { status: "error", message: `Import non riuscito: ${error.message}` };

  const { data: db, error: dbError } = await admin
    .from("monthly_summary")
    .select("month, income_cents, expense_cents, fixed_expense_cents, investment_cents")
    .order("month");
  if (dbError) return { status: "error", message: `Import fatto, ma verifica non riuscita: ${dbError.message}` };

  return { ...result, stats: stats as ImportStats, dbMismatches: compareWithDb(report, (db ?? []) as DbMonth[]) };
}
