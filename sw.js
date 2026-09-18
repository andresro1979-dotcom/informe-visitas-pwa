// Subir esta versión cada vez que se agreguen/cambien archivos del app shell: si no se sube,
// los celulares que ya instalaron la PWA siguen usando el Service Worker (y la caché) vieja.
const CACHE_NAME = 'informe-visita-shell-v2';
const ARCHIVOS_SHELL = [
  './',
  './index.html',
  './pwa-api.js',
  './te1.js',
  './checklist-te1.json',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ARCHIVOS_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nombres =>
      Promise.all(nombres.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Las llamadas al backend de Apps Script nunca se cachean ni se interceptan: si no hay
// conexión, deben fallar (index.html las encola offline), no responder con datos viejos.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // App shell: se sirve de caché al instante (offline-first) y se refresca en segundo plano.
  event.respondWith(
    caches.match(event.request).then(respuestaCache => {
      const fetchPromise = fetch(event.request)
        .then(respuestaRed => {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, respuestaRed.clone()));
          return respuestaRed;
        })
        .catch(() => respuestaCache);
      return respuestaCache || fetchPromise;
    })
  );
});
