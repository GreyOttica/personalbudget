import type { NextRequest } from "next/server";
import { missingEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const missing = missingEnv();
  if (missing.length) return configErrorPage(missing);
  return updateSession(request);
}

// Pagina di errore leggibile al posto di "Internal Server Error" quando su
// Vercel manca una variabile d'ambiente. Mostra solo i nomi, mai i valori.
function configErrorPage(missing: string[]) {
  const items = missing.map((m) => `<li><code>${m}</code></li>`).join("");
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurazione incompleta</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:560px;margin:10vh auto;padding:0 16px;line-height:1.5}code{background:#8882;padding:2px 6px;border-radius:6px}</style></head>
<body><h1>Configurazione incompleta</h1>
<p>Su Vercel mancano queste variabili d'ambiente:</p><ul>${items}</ul>
<p>Aggiungile in <b>Settings → Environment Variables</b> (ambiente Production), poi fai <b>Deployments → ⋯ → Redeploy</b>:
le variabili valgono solo per i deploy fatti dopo averle salvate.</p></body></html>`;
  return new Response(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export const config = {
  // Esclude asset statici, icone e file della PWA.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
