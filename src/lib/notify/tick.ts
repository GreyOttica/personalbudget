import "server-only";
import { budgetSignals, signalText } from "@/lib/analytics/alerts";
import { monthOf } from "@/lib/analytics/dashboard";
import { dashboardFor } from "@/lib/ai/facts";
import { loadAll } from "@/lib/analytics/loadAll";
import { runAnalysis } from "@/lib/ai/analyze";
import { aiConfigured } from "@/lib/ai/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runBackup } from "./backup";
import { sendPush } from "./push";
import { alertsAllowed, dueJobs, romeNow } from "./time";

type Admin = ReturnType<typeof createAdminClient>;
type Settings = {
  budget_alerts: boolean;
  projections: boolean;
  reminder: boolean;
  daily_analysis: boolean;
  weekly_report: boolean;
  monthly_report: boolean;
  backup: boolean;
};
const DEFAULTS: Settings = { budget_alerts: true, projections: true, reminder: true, daily_analysis: true, weekly_report: true, monthly_report: true, backup: true };
const MAX_ALERTS_PER_TICK = 3;

/** "Prenota" una chiave: vero solo per il primo che la scrive, così nessun job parte due volte. */
async function claim(admin: Admin, key: string, kind: string) {
  const { data, error } = await admin.from("notification_log").upsert({ key, kind }, { onConflict: "key", ignoreDuplicates: true }).select("key");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
const release = (admin: Admin, key: string) => admin.from("notification_log").delete().eq("key", key);
const record = (admin: Admin, key: string, title: string, body: string, sent: number) =>
  admin.from("notification_log").update({ title, body, sent }).eq("key", key);

/**
 * Il controllo automatico (ogni 15 minuti da Supabase). Decide in base all'ora di Roma.
 * Al massimo un'analisi AI per giro, per stare nei tempi della funzione: le altre al giro dopo.
 */
export async function runTick(at = new Date()) {
  const admin = createAdminClient();
  const t = romeNow(at);
  const done: string[] = [];
  await admin.from("app_config").update({ last_tick_at: at.toISOString() }).eq("id", true);
  const { data: s } = await admin.from("notification_settings").select("*").eq("id", true).maybeSingle();
  const settings: Settings = { ...DEFAULTS, ...(s ?? {}) };

  // Ricorrenti automatici del giorno (idempotente) e dati aggiornati.
  await admin.rpc("generate_recurring", { p_today: t.date });

  // 1. Avvisi sul budget: 80%, 100% e "al ritmo attuale sforerai".
  if (alertsAllowed(t) && (settings.budget_alerts || settings.projections)) {
    const all = await loadAll(admin as never);
    const month = monthOf(t.date);
    const d = dashboardFor({ ...all, today: t.date }, month);
    const signals = budgetSignals(d).filter((x) => (x.level === "projection" ? settings.projections : settings.budget_alerts));
    let n = 0;
    for (const sig of signals) {
      if (n >= MAX_ALERTS_PER_TICK) break;
      // Se è già scattato il livello più alto non mando quello più basso (es. 80% dopo "superato").
      if (!(await claim(admin, sig.key, `budget_${sig.level}`))) continue;
      const msg = signalText(sig);
      const sent = await sendPush(admin, { ...msg, url: "/budget", tag: `budget-${sig.categoryId}` });
      await record(admin, sig.key, msg.title, msg.body, sent);
      done.push(sig.key);
      n++;
    }
    // Livelli già superati: segno come fatti quelli più bassi, così non arrivano dopo.
    for (const sig of signals) {
      if (sig.level === "over") {
        await claim(admin, `warning:${sig.categoryId}:${month}`, "budget_warning");
        await claim(admin, `projection:${sig.categoryId}:${month}`, "budget_projection");
      } else if (sig.level === "warning") await claim(admin, `projection:${sig.categoryId}:${month}`, "budget_projection");
    }
  }

  // 2. Job a orario: promemoria, analisi, report, backup.
  let aiUsed = false;
  for (const job of dueJobs(t)) {
    const enabled =
      job.kind === "reminder" ? settings.reminder
      : job.kind === "daily" ? settings.daily_analysis
      : job.kind === "weekly" ? settings.weekly_report
      : job.kind === "monthly" ? settings.monthly_report
      : settings.backup;
    if (!enabled) continue;
    const isAi = job.kind === "daily" || job.kind === "weekly" || job.kind === "monthly";
    if (isAi && (aiUsed || !aiConfigured())) continue;
    if (!(await claim(admin, job.key, job.kind))) continue;
    try {
      if (job.kind === "reminder") {
        const { count } = await admin
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .neq("source", "recurring")
          .eq("occurred_on", t.date);
        if ((count ?? 0) > 0) {
          await record(admin, job.key, "Promemoria non necessario", `${count} movimenti oggi`, 0);
        } else {
          const msg = { title: "Hai registrato le spese di oggi?", body: "Oggi non c'è ancora nessun movimento. Bastano pochi secondi." };
          await record(admin, job.key, msg.title, msg.body, await sendPush(admin, { ...msg, url: "/nuovo", tag: "reminder" }));
        }
      } else if (job.kind === "backup") {
        const b = await runBackup(admin, t.date);
        await record(admin, job.key, "Backup", `${b.file} · ${b.rows} righe`, 0);
      } else {
        aiUsed = true;
        const res = await runAnalysis(job.kind, admin as never, t.date);
        if (!res.ok) throw new Error(res.error);
        const label = job.kind === "daily" ? "Analisi della sera" : job.kind === "weekly" ? "Report della settimana" : "Report del mese";
        const sent = await sendPush(admin, { title: label, body: res.headline, url: "/analisi", tag: job.kind });
        await record(admin, job.key, label, res.headline, sent);
      }
      done.push(job.key);
    } catch (e) {
      // Fallito: libero la chiave, ci riprova il controllo successivo.
      await release(admin, job.key);
      done.push(`${job.key} ERRORE ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { at: t, done };
}
