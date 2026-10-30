"use server";

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
  if (email !== ownerEmail()) return { step: "email", email, error: "Questa email non è autorizzata." };

  const supabase = await createClient();
  // shouldCreateUser: false → nessuna registrazione dal login, l'utente esiste già.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) {
    const tooMany = error.status === 429 || /rate limit/i.test(error.message);
    return {
      step: "email",
      email,
      error: tooMany
        ? "Troppe richieste: aspetta qualche minuto prima di chiedere un nuovo codice."
        : `Invio del codice non riuscito: ${error.message}`,
    };
  }
  return { step: "code", email, info: `Ti ho mandato un codice a ${email}.` };
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
