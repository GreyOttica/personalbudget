"use client";

import { useRef } from "react";
import { clearLocalData, syncStore } from "@/lib/offline/sync";

/** Esce e cancella dal telefono i dati salvati per l'uso offline. */
export function SignOutButton() {
  const form = useRef<HTMLFormElement>(null);

  async function signOut() {
    const { pending } = syncStore.get();
    if (pending > 0 && !window.confirm(`Hai ${pending} movimenti non ancora sincronizzati: uscendo li perdi. Uscire lo stesso?`)) {
      return;
    }
    await clearLocalData();
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
    form.current?.submit();
  }

  return (
    <form ref={form} action="/auth/signout" method="post">
      <button type="button" className="link-button" onClick={() => void signOut()}>
        Esci
      </button>
    </form>
  );
}
