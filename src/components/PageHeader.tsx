import Link from "next/link";

/** Intestazione delle pagine di analisi: ritorno ad Altro + titolo + sottotitolo. */
export function PageHeader({ title, subtitle, back = "/altro", backLabel = "Altro" }: { title: string; subtitle?: string; back?: string; backLabel?: string }) {
  return (
    <>
      <Link href={back} className="back-link">
        ‹ {backLabel}
      </Link>
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </>
  );
}
