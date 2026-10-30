"use client";

import { PageLink } from "@/components/PageLink";
import { useSyncState } from "@/lib/offline/hooks";
import { flush } from "@/lib/offline/sync";

/** Stato della sincronizzazione: offline, movimenti in attesa, errori. Toccalo per riprovare. */
export function SyncBadge() {
  const s = useSyncState();

  let label: string;
  let tone: "ok" | "warn" | "error";
  if (s.error === "auth") {
    label = "Accedi di nuovo";
    tone = "error";
  } else if (!s.online) {
    label = s.pending ? `Offline · ${s.pending} in attesa` : "Offline";
    tone = "warn";
  } else if (s.error === "server") {
    label = s.pending ? `Errore · ${s.pending} in attesa` : "Errore di sincronizzazione";
    tone = "error";
  } else if (s.pending || s.syncing) {
    label = s.pending ? `Sincronizzo ${s.pending}…` : "Sincronizzo…";
    tone = "warn";
  } else {
    label = "Sincronizzato";
    tone = "ok";
  }

  if (s.error === "auth") {
    return (
      <PageLink href="/login" className={`sync-badge sync-${tone}`}>
        {label}
      </PageLink>
    );
  }
  return (
    <button type="button" className={`sync-badge sync-${tone}`} onClick={() => void flush()} aria-live="polite">
      {label}
    </button>
  );
}
