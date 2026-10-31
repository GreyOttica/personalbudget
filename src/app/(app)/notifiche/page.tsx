import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader } from "@/components/PageHeader";
import { requireOwner } from "@/lib/auth";
import { listBackups } from "@/lib/notify/backup";
import { rememberAppUrl, vapidKeys } from "@/lib/notify/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingObject } from "@/lib/supabase/missing";
import { createClient } from "@/lib/supabase/server";
import { NotificationsPanel, type LogRow, type NotifSettings } from "./NotificationsPanel";

export const metadata: Metadata = { title: "Notifiche" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireOwner();
  const supabase = await createClient();
  const admin = createAdminClient();
  const settings = await supabase.from("notification_settings").select("*").eq("id", true).maybeSingle();
  if (settings.error || !settings.data) {
    return (
      <main className="page">
        <PageHeader title="Notifiche" back="/altro" />
        <section className="card card-padded">
          <p>
            {isMissingObject(settings.error) || !settings.data
              ? "Esegui prima su Supabase la migrazione 20261101000007_notifications.sql (SQL Editor)."
              : settings.error?.message}
          </p>
        </section>
      </main>
    );
  }

  // Salvo l'indirizzo dell'app: serve al controllo automatico di Supabase per chiamarla.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  await rememberAppUrl(admin, host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : null);

  const [keys, config, devices, log, backups] = await Promise.all([
    vapidKeys(admin),
    admin.from("app_config").select("last_tick_at, app_url").eq("id", true).single(),
    supabase.from("push_subscriptions").select("endpoint", { count: "exact", head: true }),
    supabase.from("notification_log").select("key, kind, title, body, sent, created_at").not("title", "is", null).order("created_at", { ascending: false }).limit(15),
    listBackups(admin),
  ]);

  return (
    <main className="page">
      <PageHeader title="Notifiche" back="/altro" />
      <NotificationsPanel
        publicKey={keys.publicKey}
        settings={settings.data as NotifSettings}
        devices={devices.count ?? 0}
        lastTick={config.data?.last_tick_at ?? null}
        appUrl={config.data?.app_url ?? null}
        log={(log.data ?? []) as LogRow[]}
        backups={backups}
      />
    </main>
  );
}
