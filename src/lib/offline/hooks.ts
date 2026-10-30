"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Reference, Txn } from "@/lib/entry/types";
import { localReference, localTransactions, startSync, syncStore } from "./sync";

export function useSyncState() {
  useEffect(startSync, []);
  return useSyncExternalStore(syncStore.subscribe, syncStore.get, syncStore.get);
}

/** Dati locali che si ricaricano a ogni modifica o sincronizzazione. undefined = in caricamento. */
function useLocal<T>(load: () => Promise<T>): T | undefined {
  const { version } = useSyncState();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    void load().then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
  }, [version, load]);
  return value;
}

export const useReference = (): Reference | null | undefined => useLocal(localReference);
export const useTransactions = (): (Txn & { pending: boolean })[] | undefined => useLocal(localTransactions);
