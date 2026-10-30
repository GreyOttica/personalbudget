"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Icone SVG disegnate a mano (24×24, tratto 2px) per non dipendere da librerie.
const icons = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </>
  ),
  budget: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9z" />
      <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
};

const tabs = [
  { href: "/", label: "Home", icon: icons.home },
  { href: "/movimenti", label: "Movimenti", icon: icons.list },
  { href: "/nuovo", label: "Nuovo", icon: null },
  { href: "/budget", label: "Budget", icon: icons.budget },
  { href: "/altro", label: "Altro", icon: icons.more },
] as const;

export function TabBar() {
  const pathname = usePathname();
  // Durante l'inserimento la barra sparisce: tutta l'attenzione al questionario.
  if (pathname.startsWith("/nuovo")) return null;

  return (
    <nav className="tabbar" aria-label="Navigazione principale">
      {tabs.map((t) => {
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        if (!t.icon) {
          return (
            <Link key={t.href} href={t.href} className="tab tab-add" aria-label="Nuovo movimento">
              <span className="tab-add-circle" aria-hidden>
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </Link>
          );
        }
        return (
          <Link key={t.href} href={t.href} className={`tab ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {t.icon}
            </svg>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
