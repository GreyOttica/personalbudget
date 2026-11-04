import Link from "next/link";
import { addMonths } from "@/lib/analytics/dashboard";
import { formatMonth } from "@/lib/format";

/** ‹ Novembre 2026 › — `base` è la pagina ("/" o "/grafici"); il mese in corso non ha parametro. */
export function MonthSwitch({ month, current, base }: { month: string; current: string; base: string }) {
  const href = (m: string) => (m === current ? base : `${base}?m=${m}`);
  return (
    <nav className="month-switch" aria-label="Cambia mese">
      <Link href={href(addMonths(month, -1))} className="month-arrow" aria-label="Mese precedente">
        ‹
      </Link>
      <h1>{formatMonth(`${month}-01`)}</h1>
      {month < current ? (
        <Link href={href(addMonths(month, 1))} className="month-arrow" aria-label="Mese successivo">
          ›
        </Link>
      ) : (
        <span className="month-arrow disabled" aria-hidden>
          ›
        </span>
      )}
    </nav>
  );
}
