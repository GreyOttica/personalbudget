"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { backupNow, previewBackup, restoreBackup, saveSetting } from "./actions";
import { flush } from "@/lib/offline/sync";
import type { SettingKey } from "./keys";

export type NotifSettings = Record<SettingKey, boolean>;
export type LogRow = { key: string; kind: string; title: string | null; body: string | null; sent: number; created_at: string };
type Backup = { name: string; size: number | null; url: string | null };

const ROWS: { key: SettingKey; title: string; hint: string }[] = [
  { key: "projections", title: "Proiezioni sul budget e obiettivi", hint: "«Al ritmo attuale sui ristoranti sforerai di 40 €», obiettivi a rischio (dal giorno 10)" },
  { key: "budget_alerts", title: "Budget e abbonamenti", hint: "Budget all'80% e superato (una volta per categoria e per viaggio), abbonamenti aumentati o nuovi" },
  { key: "positive", title: "Quando vai bene", hint: "«Stai andando bene: risparmi 120 € più del solito», serie di giorni sotto la quota (max 1 al giorno, la sera)" },
  { key: "reminder", title: "Promemoria delle 21:00", hint: "Solo se oggi non hai registrato nulla" },
  { key: "daily_analysis", title: "Analisi della sera", hint: "Alle 21:30, con il titolo dell'analisi" },
  { key: "weekly_report", title: "Report del lunedì", hint: "Lunedì alle 8:00, sulla settimana appena finita" },
  { key: "monthly_report", title: "Report del mese", hint: "Il 1° del mese alle 8:00" },
  { key: "backup", title: "Backup settimanale", hint: "Domenica notte su Supabase Storage (senza notifica)" },
];

const KIND_ICON: Record<string, string> = {
  budget_projection: "📈",
  budget_warning: "⚠️",
  budget_over: "🔴",
  reminder: "✍️",
  daily: "🌙",
  weekly: "🗓️",
  monthly: "📆",
  backup: "💾",
  positive: "👏",
  goals_risk: "🏁",
  tag_warning: "🏷️",
  tag_over: "🏷️",
  sub_up: "🔁",
  sub_new: "🔁",
};

function urlB64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Env = "server" | "unsupported" | "ios-browser" | "ok";
const noop = () => () => {};
function readEnv(): Env {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "ios-browser"; // su iPhone le notifiche funzionano solo dall'app sulla schermata Home
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

/** Da quanto tempo (ms); fuori dal componente perché legge l'orologio. */
function ageMs(iso: string | null) {
  return iso ? Date.now() - new Date(iso).getTime() : null;
}

const when = (iso: string) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotificationsPanel(props: {
  publicKey: string;
  settings: NotifSettings;
  devices: number;
  lastTick: string | null;
  appUrl: string | null;
  log: LogRow[];
  backups: Backup[];
}) {
  const router = useRouter();
  const env = useSyncExternalStore(noop, readEnv, () => "server" as Env);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [settings, setSettings] = useState(props.settings);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (env !== "ok") return;
    navigator.serviceWorker.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setSubscribed(!!s))
      .catch(() => setSubscribed(false));
  }, [env]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage({ ok: false, text: "Permesso negato. Su iPhone: Impostazioni → Notifiche → Budget → Consenti notifiche." });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(props.publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Errore ${res.status}`);
      setSubscribed(true);
      setMessage({ ok: true, text: "Notifiche attive su questo dispositivo. Prova con «Invia una notifica di prova»." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMessage({ ok: true, text: "Notifiche disattivate su questo dispositivo." });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function call(url: string, okText: (b: Record<string, unknown>) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      setMessage(res.ok ? { ok: true, text: okText(b) } : { ok: false, text: String(b.error ?? `Errore ${res.status}`) });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Serve la connessione a internet." });
    } finally {
      setBusy(false);
    }
  }

  async function restore(source: { name: string } | { json: string }) {
    setBackupMsg(null);
    let when = "";
    let count = 0;
    if ("name" in source) {
      const info = await previewBackup(source.name);
      if (!info.ok) return setBackupMsg({ ok: false, text: info.message });
      when = new Date(info.createdAt).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" });
      count = info.rows.transactions ?? 0;
    } else {
      try {
        const b = JSON.parse(source.json) as { app?: string; created_at?: string; tables?: { transactions?: unknown[] } };
        if (b.app !== "personal-budget") return setBackupMsg({ ok: false, text: "Il file non è un backup di questa app." });
        when = b.created_at ? new Date(b.created_at).toLocaleString("it-IT", { timeZone: "Europe/Rome", dateStyle: "long", timeStyle: "short" }) : "data sconosciuta";
        count = b.tables?.transactions?.length ?? 0;
      } catch {
        return setBackupMsg({ ok: false, text: "Il file non è un JSON valido." });
      }
    }
    const answer = window.prompt(
      `Ripristinare il backup del ${when} (${count} movimenti)?\n\nTutti i dati attuali verranno sostituiti (prima salvo un backup di adesso). Scrivi RIPRISTINA per confermare.`,
    );
    if (answer?.trim().toUpperCase() !== "RIPRISTINA") return setBackupMsg({ ok: false, text: "Ripristino annullato." });
    setBusy(true);
    const r = await restoreBackup(source);
    setBusy(false);
    setBackupMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      void flush(); // aggiorna anche i dati salvati sul telefono
      router.refresh();
    }
  }

  function toggle(key: SettingKey, value: boolean) {
    setSettings((s) => ({ ...s, [key]: value }));
    startTransition(async () => {
      const r = await saveSetting(key, value);
      if (!r.ok) {
        setSettings((s) => ({ ...s, [key]: !value }));
        setMessage({ ok: false, text: r.error ?? "Non salvato" });
      }
    });
  }

  const tickAge = ageMs(props.lastTick);

  return (
    <>
      <h2 className="group-title">Questo dispositivo</h2>
      <section className="card card-padded notif-device">
        {env === "server" ? (
          <p className="muted">Controllo…</p>
        ) : env === "ios-browser" ? (
          <>
            <p>
              <strong>Su iPhone le notifiche funzionano solo dall&apos;app installata.</strong>
            </p>
            <ol className="small notif-steps">
              <li>Apri l&apos;indirizzo dell&apos;app in Safari.</li>
              <li>Condividi → Aggiungi alla schermata Home.</li>
              <li>Apri l&apos;app dall&apos;icona e torna qui: Altro → Notifiche.</li>
            </ol>
          </>
        ) : env === "unsupported" ? (
          <p>Questo browser non supporta le notifiche push. Su iPhone serve iOS 16.4 o successivo e l&apos;app sulla schermata Home.</p>
        ) : (
          <>
            <div className="cost-row">
              <span>Notifiche</span>
              <strong className={subscribed ? "good-text" : undefined}>{subscribed === null ? "…" : subscribed ? "Attive" : "Spente"}</strong>
            </div>
            {subscribed ? (
              <div className="button-row">
                <button type="button" className="button" disabled={busy} onClick={() => call("/api/push/test", () => "Inviata: dovrebbe arrivare entro pochi secondi.")}>
                  Invia una notifica di prova
                </button>
                <button type="button" className="button button-secondary" disabled={busy} onClick={disable}>
                  Disattiva
                </button>
              </div>
            ) : (
              <button type="button" className="button button-big" disabled={busy || subscribed === null} onClick={enable}>
                {busy ? "Attivo…" : "Attiva le notifiche"}
              </button>
            )}
          </>
        )}
        {message && <p className={`small ${message.ok ? "good-text" : "check-diff"}`}>{message.text}</p>}
        <p className="muted small">
          {props.devices === 0 ? "Nessun dispositivo abilitato." : props.devices === 1 ? "1 dispositivo abilitato." : `${props.devices} dispositivi abilitati.`}
        </p>
      </section>

      <h2 className="group-title">Cosa ricevere</h2>
      <ul className="card list">
        {ROWS.map((r) => (
          <li key={r.key} className="list-row notif-row">
            <span className="menu-main">
              <strong>{r.title}</strong>
              <span className="muted small">{r.hint}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              aria-label={r.title}
              checked={settings[r.key]}
              onChange={(e) => toggle(r.key, e.target.checked)}
            />
          </li>
        ))}
      </ul>

      <h2 className="group-title">Controllo automatico</h2>
      <section className="card card-padded notif-device">
        <div className="cost-row">
          <span>Ultimo controllo</span>
          <strong className={tickAge !== null && tickAge < 40 * 60_000 ? "good-text" : undefined}>{props.lastTick ? when(props.lastTick) : "mai"}</strong>
        </div>
        <p className="muted small">
          {props.lastTick === null
            ? "Supabase chiama l'app ogni 15 minuti. Se resta «mai» anche dopo un quarto d'ora, la migrazione 0007 non è stata eseguita."
            : tickAge !== null && tickAge > 40 * 60_000
              ? "Il controllo non arriva da più di 40 minuti: verifica su Supabase (Integrations → Cron) che il job «budget-tick» sia attivo."
              : "Ogni 15 minuti Supabase chiama l'app, che controlla budget, orari dei report e backup."}
          {props.appUrl ? ` Indirizzo: ${props.appUrl}` : ""}
        </p>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => call("/api/cron/tick", (b) => `Controllo fatto. ${((b.done as string[]) ?? []).length ? `Eseguito: ${(b.done as string[]).join(", ")}` : "Niente da fare adesso."}`)}>
          Esegui il controllo adesso
        </button>
      </section>

      {props.log.length > 0 && (
        <>
          <h2 className="group-title">Ultime notifiche</h2>
          <ul className="card list">
            {props.log.map((l) => (
              <li key={l.key} className="list-row notif-log">
                <span className="menu-icon" aria-hidden>
                  {KIND_ICON[l.kind] ?? "🔔"}
                </span>
                <span className="menu-main">
                  <strong>{l.title ?? l.kind}</strong>
                  {l.body && <span className="small">{l.body}</span>}
                  <span className="muted small">
                    {when(l.created_at)}
                    {l.kind !== "backup" && (l.sent > 0 ? " · inviata" : " · non inviata (nessun dispositivo o non necessaria)")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="group-title">Backup</h2>
      <section className="card card-padded notif-device">
        {props.backups.length === 0 ? (
          <p className="muted small">Nessun backup ancora. Il primo arriva domenica notte, oppure fallo adesso.</p>
        ) : (
          <ul className="backup-list">
            {props.backups.map((b) => (
              <li key={b.name} className="backup-row">
                <span>
                  {b.url ? (
                    <a href={b.url} download>
                      {b.name}
                    </a>
                  ) : (
                    b.name
                  )}
                  {b.size !== null && <span className="muted small"> · {Math.round(b.size / 1024)} KB</span>}
                </span>
                <button type="button" className="link-button small" disabled={busy} onClick={() => restore({ name: b.name })}>
                  Ripristina
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await backupNow();
            setBackupMsg({ ok: r.ok, text: r.message });
            setBusy(false);
            router.refresh();
          }}
        >
          Fai un backup adesso
        </button>
        {backupMsg && <p className={`small ${backupMsg.ok ? "good-text" : "check-diff"}`}>{backupMsg.text}</p>}
        <label className="link-button small backup-file">
          Ripristina da un file…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await restore({ json: await f.text() });
            }}
          />
        </label>
        <p className="muted small">
          Si tengono gli ultimi 12. Contengono tutti i movimenti: scaricali solo su dispositivi tuoi. Il ripristino sostituisce tutti i dati con
          quelli del backup; prima l&apos;app salva lo stato attuale, così puoi tornare indietro.
        </p>
      </section>

      <h2 className="group-title">Prova su iPhone</h2>
      <section className="card card-padded">
        <ol className="small notif-steps">
          <li>Serve iOS 16.4 o successivo e l&apos;app aperta dall&apos;icona sulla schermata Home (non da Safari).</li>
          <li>Tocca «Attiva le notifiche» e poi «Consenti».</li>
          <li>Tocca «Invia una notifica di prova»: blocca il telefono e aspetta qualche secondo.</li>
          <li>Se non arriva: Impostazioni di iOS → Notifiche → Budget → attiva «Consenti notifiche»; controlla che la modalità Full immersion non le blocchi.</li>
          <li>Se reinstalli l&apos;app sulla schermata Home, riattiva le notifiche da qui.</li>
        </ol>
      </section>
    </>
  );
}
