/* Thistle Rock — Meeting Intelligence service worker
   v1.0 · 12 August 2026 · v1.1 · 22 October 2026

   WHY THIS EXISTS
   Without it the app will not open with no signal (a basement, a car), so no meeting can
   be recorded there.

   THE ONE THING THIS MUST NOT DO
   Serve a stale build forever. The page is fetched NETWORK-FIRST:
     * online  -> always fetch fresh, then quietly refresh the cached copy
     * offline -> serve the last known good copy so the app still opens

   v1.1 (audit M14):
     * the offline fallback never reached index.html: caches.match() returns a promise,
       which is always "truthy", so `hit || caches.match('./') || ...` stopped at the
       second step. The lookups are now chained.
     * a weak signal used to hang the app; the page now falls back to the cached copy if
       the network has not answered within 6 seconds.
     * the app shell is cached on install, so the first launch after install works offline.
     * every ?u= update URL used to be cached as a separate entry; the page is now stored
       under one key.
*/
const CACHE = 'tr-meetings-v2';
const SHELL = './';
const NAV_TIMEOUT_MS = 6000;

self.addEventListener('install', function (e) {
  self.skipWaiting();                      // never leave an old worker in charge
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.add(SHELL); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                             .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cachedShell(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || caches.match(SHELL, { ignoreSearch: true });
  }).then(function (hit) {
    return hit || caches.match('./index.html', { ignoreSearch: true });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // never cache uploads or saves
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // leave the Worker and AssemblyAI alone
  if (url.search.indexOf('vercheck=') >= 0) return;       // the update check must always hit the network

  /* only THE APP is cached as the app: another page (the rescue page) must never be
     stored as the shell, or the app could open as that page offline */
  var scopePath = new URL(self.registration.scope).pathname;
  var isApp = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
  if (req.mode === 'navigate' && !isApp) return;          // other pages: straight to the network
  if (!isApp) {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); }).catch(function () {}); }
      return res;
    }).catch(function () { return caches.match(url.pathname).then(function (h) { return h || Response.error(); }); }));
    return;
  }
  e.respondWith(new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      cachedShell(req).then(function (hit) { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NAV_TIMEOUT_MS);
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(SHELL, copy); }).catch(function () {}); }
      if (!settled) { settled = true; clearTimeout(timer); resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      cachedShell(req).then(function (hit) {
        if (!settled) { settled = true; resolve(hit || new Response('<h1>Offline</h1><p>The app has not been opened online on this phone yet.</p>', { headers: { 'content-type': 'text/html' } })); }
      });
    });
  }));
});
