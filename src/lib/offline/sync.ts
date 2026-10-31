// Sincronizzazione tra archivio locale e server.
// Ogni modifica va prima in coda (outbox), poi parte flush(): se la rete non c'è,
// la coda resta lì e riparte da sola al ritorno della rete, quando l'app torna
// in primo piano e ogni 30 secondi finché c'è qualcosa in sospeso.
import type { Op, Reference, Txn, TxnDraft } from "@/lib/entry/types";
import * as store from "./db";

export type SyncState = {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  error: "auth" | "server" | null;
  version: number; // cambia a ogni aggiornamento dei dati locali
};

let state: SyncState = { online: true, pending: 0, syncing: false, lastSyncAt: null, error: null, version: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const syncStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => state,
};

async function refreshPending() {
  set({ pending: (await store.getOutbox()).length, version: state.version + 1 });
}

// --- operazioni dell'utente -------------------------------------------------------

export async function saveTxn(txn: TxnDraft) {
  await store.putOp({ op: "upsert", id: txn.id, updated_at: txn.updated_at, txn });
  await refreshPending();
  void flush();
}

export async function deleteTxn(id: string) {
  // Sempre una cancellazione in coda, anche per un movimento appena creato: potrebbe essere già in viaggio
  // verso il server (sincronizzazione in corso) o essere fuori dalla finestra salvata sul telefono.
  // Sul server cancellare un movimento che non c'è non fa nulla.
  await store.putOp({ op: "delete", id, updated_at: new Date().toISOString() });
  await refreshPending();
  void flush();
}

// --- dati da mostrare -----------------------------------------------------------------

/** Movimenti del server con sopra le modifiche ancora in coda. */
export async function localTransactions(): Promise<(Txn & { pending: boolean })[]> {
  const [server, outbox] = await Promise.all([store.getServerTransactions(), store.getOutbox()]);
  const byId = new Map<string, Txn & { pending: boolean }>(server.map((t) => [t.id, { ...t, pending: false }]));
  for (const op of outbox) {
    if (op.op === "delete") byId.delete(op.id);
    else byId.set(op.id, { ...op.txn, pending: true });
  }
  return [...byId.values()].sort(
    (a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.updated_at.localeCompare(a.updated_at),
  );
}

/** Riferimenti dal server, con in più le sottocategorie create sul telefono e non ancora sincronizzate. */
export async function localReference(): Promise<Reference | null> {
  const [{ reference }, outbox] = await Promise.all([store.getMeta(), store.getOutbox()]);
  if (!reference) return null;
  const subs = [...reference.subcategories];
  for (const op of outbox) {
    if (op.op !== "upsert" || !op.txn.subcategory_name || !op.txn.subcategory_id) continue;
    if (!subs.some((s) => s.id === op.txn.subcategory_id)) {
      subs.push({ id: op.txn.subcategory_id, category_id: op.txn.category_id, name: op.txn.subcategory_name, uses: 0 });
    }
  }
  return { ...reference, subcategories: subs };
}

// --- rete -----------------------------------------------------------------------------

let running: Promise<void> | null = null;

export function flush(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ online: false });
    return;
  }
  set({ syncing: true });
  try {
    const ops = await store.getOutbox();
    if (ops.length) {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: ops.map(toWire) }),
      });
      if (res.status === 401) return set({ error: "auth", online: true });
      if (!res.ok) return set({ error: "server", online: true });
      for (const op of ops) await store.removeOpIfUnchanged(op);
    }

    const [ref, txns] = await Promise.all([fetch("/api/reference"), fetch("/api/transactions")]);
    if (ref.status === 401 || txns.status === 401) return set({ error: "auth", online: true });
    if (!ref.ok || !txns.ok) return set({ error: "server", online: true });
    await store.saveServerData((await ref.json()) as Reference, (await txns.json()) as Txn[]);
    set({ error: null, online: true, lastSyncAt: new Date().toISOString() });
  } catch {
    // fetch fallisce senza rete (o con rete instabile): riproviamo più tardi.
    set({ online: false });
  } finally {
    set({ syncing: false });
    await refreshPending();
  }
}

function toWire(op: Op) {
  return op.op === "delete" ? { op: "delete", id: op.id, updated_at: op.updated_at } : { op: "upsert", txn: op.txn };
}

// --- avvio ---------------------------------------------------------------------------

let started = false;

export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ online: navigator.onLine });
  window.addEventListener("online", () => {
    set({ online: true });
    void flush();
  });
  window.addEventListener("offline", () => set({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  setInterval(() => {
    if (state.pending > 0) void flush();
  }, 30_000);
  void refreshPending().then(flush);
}

export async function clearLocalData() {
  await store.clearAll();
  await refreshPending();
}
