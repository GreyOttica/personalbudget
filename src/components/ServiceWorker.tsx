"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Registra il service worker e, quando sei dentro l'app, gli chiede di salvare
 * le pagine per l'uso offline. Si ripete al cambio pagina perché dopo il login
 * si arriva alla Home senza ricaricare.
 */
export function ServiceWorker() {
  const pathname = usePathname();

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || pathname.startsWith("/login") || !navigator.onLine) return;
    void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "warm" }));
  }, [pathname]);

  return null;
}
