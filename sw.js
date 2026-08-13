/* Thistle Rock — Meeting Intelligence service worker
   v1.0 · 12 August 2026

   WHY THIS EXISTS
   The app is a Home Screen web app with no offline capability at all. Every cold
   launch fetched index.html from the network, so in a basement meeting room, a car,
   or anywhere without signal the app simply would not open and no meeting could be
   recorded. That is a whole failure category with no defence, and it is cheap to close.

   THE ONE THING THIS MUST NOT DO
   A service worker is the classic way to serve a stale build forever. On 12 August a
   deployed build sat unseen on the phone because of caching, so the strategy here is
   deliberately NETWORK-FIRST for the page itself:

     * online  -> always fetch fresh, then quietly refresh the cached copy
     * offline -> serve the last known good copy so the app still opens

   The cache is therefore a fallback, never the source of truth. Combined with the
   in-app update check, a stale build cannot go unnoticed.
*/
const CACHE = 'tr-meetings-v1';

self.addEventListener('install', function (e) {
  self.skipWaiting();                      // never leave an old worker in charge
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // never cache uploads or saves

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // leave the Worker and AssemblyAI alone
  if (url.search.indexOf('vercheck=') >= 0) return;       // the update check must always hit the network

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      // offline: fall back to whatever we last saw, then to the app shell
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./') || caches.match('./index.html');
      });
    })
  );
});
