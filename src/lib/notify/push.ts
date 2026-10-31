import "server-only";
import webpush from "web-push";
import { ownerEmail } from "@/lib/env";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;
export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Chiavi VAPID: generate al primo uso e salvate in app_config (leggibile solo dal server). */
export async function vapidKeys(admin: Admin): Promise<{ publicKey: string; privateKey: string }> {
  const { data, error } = await admin.from("app_config").select("vapid_public, vapid_private").eq("id", true).single();
  if (error) throw new Error(error.message);
  if (data.vapid_public && data.vapid_private) return { publicKey: data.vapid_public, privateKey: data.vapid_private };
  const keys = webpush.generateVAPIDKeys();
  // "is null": se due richieste generano insieme, vince la prima e l'altra rilegge.
  await admin.from("app_config").update({ vapid_public: keys.publicKey, vapid_private: keys.privateKey }).eq("id", true).is("vapid_public", null);
  const again = await admin.from("app_config").select("vapid_public, vapid_private").eq("id", true).single();
  if (again.error || !again.data.vapid_public) throw new Error(again.error?.message ?? "Chiavi VAPID non salvate");
  return { publicKey: again.data.vapid_public, privateKey: again.data.vapid_private };
}

/** Invia a tutti i dispositivi abilitati; quelli disattivati (404/410) vengono tolti. Restituisce quanti l'hanno ricevuta. */
export async function sendPush(admin: Admin, payload: PushPayload): Promise<number> {
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (error || !subs?.length) return 0;
  const { publicKey, privateKey } = await vapidKeys(admin);
  const body = JSON.stringify({ url: "/", ...payload });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: `mailto:${ownerEmail()}`, publicKey, privateKey },
          TTL: 12 * 3600,
          urgency: "normal",
          timeout: 10_000,
        });
        sent++;
        await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push:", status, e instanceof Error ? e.message : e);
      }
    }),
  );
  return sent;
}

/** Indirizzo pubblico dell'app, salvato perché il controllo automatico di Supabase sappia chi chiamare. */
export async function rememberAppUrl(admin: Admin, origin: string | null) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = prod ? `https://${prod}` : origin;
  if (!url || /localhost|127\.0\.0\.1/.test(url)) return;
  await admin.from("app_config").update({ app_url: url.replace(/\/+$/, "") }).eq("id", true);
}
