"use client";

import { useEffect } from "react";
import { applyPrefs, readPrefs } from "@/lib/theme";

/** Riallinea la barra di stato al tema dopo il caricamento e quando l'iPhone cambia chiaro/scuro. */
export function ThemeSync() {
  useEffect(() => {
    applyPrefs(readPrefs());
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyPrefs(readPrefs());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
