import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Accedi" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ errore?: string }> }) {
  const { errore } = await searchParams;
  const notice = errore === "non-autorizzato" ? "Questo account non è autorizzato a usare l'app." : undefined;

  return (
    <main className="page page-narrow">
      <h1>Personal Budget</h1>
      <p className="muted">Accedi con il codice che ricevi via email.</p>
      <LoginForm notice={notice} />
    </main>
  );
}
