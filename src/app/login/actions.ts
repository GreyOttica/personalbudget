"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ownerEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  step: "email" | "code";
  email: string;
  error?: string;
  info?: string;
};

function normalizeEmail(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim().toLowerCase();
}

export async function requestCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) return { step: "email", email, error: "Inserisci la tua email." };
  // Stessa risposta per qualsiasi email: non si deve poter scoprire quale indirizzo è autorizzato.
  if (email !== ownerEmail()) return { step: "code", email, info: codeSent(email) };

  const supabase = await createClient();
  // shouldCreateUser: false → nessuna registrazione dal login, l'utente esiste già.
  // L'email contiene il codice (se il template lo prevede) e un link: entrambi funzionano.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) {
    const tooMany = error.status === 429 || /rate limit/i.test(error.message);
    // Con shouldCreateUser: false Supabase risponde così se l'utente non esiste.
    const noUser = error.code === "otp_disabled" || /signups not allowed/i.test(error.message);
    return {
      step: "email",
      email,
      error: tooMany
        ? "Troppe richieste: aspetta qualche minuto prima di chiedere un nuovo codice."
        : noUser
          ? "Su Supabase non esiste ancora un utente con questa email: crealo in Authentication → Users → Add user."
          : `Invio del codice non riuscito: ${error.message}`,
    };
  }
  return { step: "code", email, info: codeSent(email) };
}

const codeSent = (email: string) => `Se ${email} è l'indirizzo autorizzato, ti arriva un codice entro un minuto. Controlla anche lo spam.`;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function verifyCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = prev.email;
  const token = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (token.length < 6) return { ...prev, info: undefined, error: "Il codice ha almeno 6 cifre." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ...prev, info: undefined, error: "Codice non valido o scaduto." };

  redirect("/");
}
