import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ownerEmail, supabasePublishableKey, supabaseUrl } from "@/lib/env";

// /api/cron/tick: chiamato da Supabase senza sessione, si autentica da solo con il segreto in app_config.
const PUBLIC_PATHS = ["/login", "/auth/signout", "/auth/callback", "/api/cron/tick"];

/**
 * Rinnova la sessione Supabase a ogni richiesta e lascia passare solo il
 * proprietario. Le API rispondono 401, le pagine reindirizzano a /login.
 */
export async function updateSession(request: NextRequest) {
  // Il link nell'email può atterrare su qualunque pagina (per esempio la Site URL
  // di Supabase): se porta un codice di accesso lo giro alla route che lo gestisce.
  const { searchParams, pathname: path } = request.nextUrl;
  if (path !== "/auth/callback" && (searchParams.has("code") || searchParams.has("token_hash"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Non inserire codice tra createServerClient e getClaims: getClaims verifica
  // il JWT e, se serve, rinnova la sessione scrivendo i cookie nella risposta.
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;
  const isOwner = email !== null && email === ownerEmail();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isOwner && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = email ? "?errore=non-autorizzato" : "";
    return redirectWithCookies(url, response);
  }

  if (isOwner && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

// Un redirect deve portarsi dietro i cookie di sessione appena rinnovati.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
