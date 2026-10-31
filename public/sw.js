// Service worker di Personal Budget.
// - File statici di Next (/_next/static, con hash nel nome): prima la cache.
// - Pagine: prima la rete; se manca, l'ultima copia salvata (così /nuovo e
//   /movimenti si aprono anche offline). Le pagine di login non vengono salvate.
// - API e richieste interne di Next: sempre in rete, mai in cache. I dati offline
//   li gestisce l'app con IndexedDB.
const VERSION = "v4";
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const OFFLINE_PAGES = ["/nuovo", "/movimenti", "/"];
const NO_CACHE = ["/login", "/auth/", "/api/", "/import"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== PAGES && key !== ASSETS) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const pageKey = (url) => new URL(url).origin + new URL(url).pathname;
// Si salvano solo le pagine che servono offline: le altre (saldo, analisi, chat, notifiche) restano solo in rete.
const cacheable = (path) => OFFLINE_PAGES.includes(path) && !NO_CACHE.some((p) => path === p || path.startsWith(p));

async function savePage(url, response) {
  if (response.ok && response.type === "basic" && !response.redirected && cacheable(new URL(url).pathname)) {
    await (await caches.open(PAGES)).put(pageKey(url), response.clone());
  }
}

// Dopo il login l'app chiede di salvare subito le pagine da usare offline.
self.addEventListener("message", (event) => {
  if (event.data?.type === "warm") {
    event.waitUntil(
      Promise.all(
        OFFLINE_PAGES.map(async (path) => {
          const url = new URL(path, self.location.origin).href;
          try {
            const res = await fetch(url, { credentials: "same-origin", redirect: "manual" });
            await savePage(url, res);
          } catch {
            // offline o errore: riproveremo alla prossima apertura
          }
        }),
      ),
    );
  }
  if (event.data?.type === "clear") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          await savePage(req.url, res);
          return res;
        } catch {
          const cache = await caches.open(PAGES);
          const hit = (await cache.match(pageKey(req.url))) ?? (await cache.match(pageKey(new URL("/nuovo", url).href)));
          return (
            hit ??
            new Response(
              '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Offline</title><body style="font-family:system-ui;padding:24px"><h1>Sei offline</h1>' +
                "<p>Apri l'app almeno una volta con la rete, così posso salvarla per l'uso offline.</p></body>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }
      })(),
    );
  }
});

// Notifiche push (avvisi budget, promemoria, report).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Budget", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Budget", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url || "/" },
    }),
  );
});

// Tocco sulla notifica: apre (o porta in primo piano) l'app sulla pagina giusta.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
