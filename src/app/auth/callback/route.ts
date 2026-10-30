import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

/**
 * Destinazione del link nell'email di accesso. Gestisce sia il flusso PKCE
 * (?code=, il link del template standard di Supabase) sia ?token_hash=&type=
 * (template personalizzato). Il codice a 6 cifre resta il metodo principale:
 * il link funziona solo se lo apri nello stesso browser in cui l'hai chiesto.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Nei route handler nextUrl può riportare l'host interno del server: per i
  // redirect uso l'host pubblico della richiesta, così i cookie restano validi.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;
  const response = NextResponse.redirect(new URL("/", origin));

  // I cookie di sessione vanno scritti sulla risposta di redirect, altrimenti
  // il browser arriva su "/" senza sessione.
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;

  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  if (ok) return response;

  return NextResponse.redirect(new URL("/login?errore=link", origin));
}
