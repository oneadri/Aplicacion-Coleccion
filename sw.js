// Permite instalar la app y abrirla sin conexión.
// Siempre intenta la versión más nueva y, si no hay internet, usa la guardada.
const CACHE = "mi-coleccion-v3";
const SHELL = ["./", "./index.html", "./app-firebase.js", "./firebase-config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./lib/firebase-app.js", "./lib/firebase-auth.js", "./lib/firebase-firestore.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const mine = u.origin === location.origin;
  const lib = u.hostname === "www.gstatic.com" || u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (!mine && !lib) return; // Firebase y el resto van directos
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
