import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Accedi" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  const notice =
    errore === "non-autorizzato"
      ? "Questo account non è autorizzato a usare l'app."
      : errore === "link"
        ? "Il link non è valido o è scaduto, oppure l'hai aperto in un browser diverso da quello in cui l'hai chiesto. Chiedi un nuovo codice."
        : undefined;

  return (
    <main className="page page-narrow">
      <h1>Personal Budget</h1>
      <p className="muted">Accedi con il codice che ricevi via email.</p>
      <LoginForm notice={notice} />
    </main>
  );
}
