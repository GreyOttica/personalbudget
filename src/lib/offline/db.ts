// Archivio locale (IndexedDB) per l'uso offline.
//   reference    → categorie, sottocategorie, conti, tag (ultima copia dal server)
//   transactions → ultimi movimenti scaricati dal server
//   outbox       → operazioni fatte sul telefono e non ancora confermate dal server,
//                  una per movimento (l'ultima sostituisce le precedenti)
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Op, Reference, Txn } from "@/lib/entry/types";

interface BudgetDB extends DBSchema {
  meta: { key: string; value: { reference?: Reference; refreshedAt?: string } };
  transactions: { key: string; value: Txn };
  outbox: { key: string; value: Op };
}

const META_KEY = "main";
let dbPromise: Promise<IDBPDatabase<BudgetDB>> | null = null;

function db() {
  dbPromise ??= openDB<BudgetDB>("personal-budget", 1, {
    upgrade(d) {
      d.createObjectStore("meta");
      d.createObjectStore("transactions", { keyPath: "id" });
      d.createObjectStore("outbox", { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function getMeta() {
  return (await (await db()).get("meta", META_KEY)) ?? {};
}

export async function saveServerData(reference: Reference, transactions: Txn[]) {
  const tx = (await db()).transaction(["meta", "transactions"], "readwrite");
  await tx.objectStore("meta").put({ reference, refreshedAt: new Date().toISOString() }, META_KEY);
  const store = tx.objectStore("transactions");
  await store.clear();
  for (const t of transactions) await store.put(t);
  await tx.done;
}

export async function getServerTransactions(): Promise<Txn[]> {
  return (await db()).getAll("transactions");
}

export async function getOutbox(): Promise<Op[]> {
  return (await db()).getAll("outbox");
}

export async function putOp(op: Op) {
  await (await db()).put("outbox", op);
}

/** Toglie un'operazione dalla coda solo se nel frattempo non è stata sostituita da una più recente. */
export async function removeOpIfUnchanged(op: Op) {
  const tx = (await db()).transaction("outbox", "readwrite");
  const current = await tx.store.get(op.id);
  if (current && current.updated_at === op.updated_at) await tx.store.delete(op.id);
  await tx.done;
}

export async function removeOp(id: string) {
  await (await db()).delete("outbox", id);
}

export async function isKnownToServer(id: string): Promise<boolean> {
  return (await (await db()).getKey("transactions", id)) !== undefined;
}

export async function clearAll() {
  const d = await db();
  const tx = d.transaction(["meta", "transactions", "outbox"], "readwrite");
  await Promise.all([tx.objectStore("meta").clear(), tx.objectStore("transactions").clear(), tx.objectStore("outbox").clear()]);
  await tx.done;
}
