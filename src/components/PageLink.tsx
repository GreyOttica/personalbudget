import type { AnchorHTMLAttributes } from "react";

/**
 * Link con caricamento completo della pagina invece della navigazione client di
 * next/link. Offline la navigazione client fallisce (chiede dati al server),
 * mentre un caricamento completo viene servito dal service worker dalla cache.
 * Usalo per i collegamenti tra le pagine che devono funzionare offline.
 */
export function PageLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
