/* Emma Study service worker.
   App-shell caching (versioned) + web push notifications.
   API traffic (Supabase) is never intercepted for caching — those
   requests always go straight to the network, untouched.

   Update strategy (shell v9 — rewritten after the v5→v7 hops proved
   the old one unreliable on real phones):
   1. This worker activates ITSELF at install (skipWaiting below).
      It never sits in the "waiting" state hoping the page's
      SKIP_WAITING message arrives — that message was the single
      point of failure in the old flow: when it didn't land, the
      update silently never took over, the banner vanished, and the
      app reported "latest version" while running the old shell.
   2. Shell files are fetched with cache:"no-cache" at install, so
      a stale HTTP-cached copy of index.html can never be baked
      into the new shell's cache (the other half of the old bug:
      a "new" worker serving the previous build's page).
   3. Page navigations are NETWORK-FIRST (see fetch handler), so
      once a new worker is in control, any reload lands the fresh
      shell even if a cache somewhere still holds the old one.
      Static assets stay cache-first; offline study still works
      because a failed navigation fetch falls back to the cache. */

var CACHE_NAME = "emma-study-shell-v10";

/* This worker lives at the PAGE ROOT (published next to index.html):
   a service worker's scope can never extend above its own directory,
   so it must sit at the root to control the page. Paths below are
   resolved against the worker's own URL at that root — the shell is
   ./ (index.html), and icons/manifest stay under ./assets/. */
var SHELL_FILES = [
  "./",
  "./index.html",
  "./assets/manifest.webmanifest",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png"
];

function shellURL(path) {
  return new URL(path, self.location.href).href;
}

/* The app root is simply this worker's scope root. */
function appURL() {
  return self.registration.scope;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* Fetch each shell file explicitly with no-cache so the new
         cache can only ever hold bytes at least as fresh as a
         revalidation with the server — never a stale HTTP cache
         entry. cache.addAll() uses default fetching and was able
         to bake the previous build's index.html into the "new"
         shell. */
      return Promise.all(SHELL_FILES.map(function (path) {
        var url = shellURL(path);
        return fetch(url, { cache: "no-cache" }).then(function (response) {
          if (!response || !response.ok) {
            throw new Error("shell fetch failed: " + path);
          }
          return cache.put(url, response);
        });
      }));
    }).then(function () {
      /* Activate immediately, without waiting for a page message.
         The page decides when to RELOAD onto the new shell (its
         Update banner / Refresh chip), so taking control here does
         not swap anything out from under a study session in
         progress — the on-screen page keeps running until reload,
         and its data comes from the network/local store, never
         from this cache. */
      return self.skipWaiting();
    })
  );
});

/* Kept for backward compatibility: older pages (shell v8 and
   earlier) post this when the person taps Update. In v9 it is a
   harmless no-op path — this worker already activated itself —
   but accept both message forms so no page build can talk past
   this worker. */
self.addEventListener("message", function (event) {
  var data = event.data;
  if (data === "SKIP_WAITING" || (data && data.type === "SKIP_WAITING")) {
    self.skipWaiting();
  }
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  /* Cross-origin requests — Supabase REST, fonts, anything else —
     are left completely alone: network only, never cached. */
  if (url.origin !== self.location.origin) return;

  /* Navigations (the page itself): NETWORK-FIRST. This is what
     makes an update land on reload regardless of what any cache
     holds — the fresh index.html comes from the network (with
     revalidation), gets stored for offline use, and the cached
     copy is only a fallback when the network is unreachable. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-cache" }).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          return caches.match(shellURL("./index.html"), { ignoreSearch: true });
        });
      })
    );
    return;
  }

  /* Everything else same-origin (icons, manifest): cache-first,
     refreshed into the cache on a miss. */
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});

/* ---------- Web push ---------- */

self.addEventListener("push", function (event) {
  var data = {};
  if (event.data) {
    try {
      data = event.data.json() || {};
    } catch (e) {
      try { data = { body: event.data.text() }; } catch (e2) { data = {}; }
    }
  }
  var title = data.title || "Study reminder";
  var options = {
    body: data.body || "Time for a quick study session!",
    icon: shellURL("./assets/icon-192.png"),
    badge: shellURL("./assets/icon-192.png"),
    tag: data.tag || "emma-study-reminder",
    data: { url: data.url || appURL() }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = appURL();
  if (event.notification.data && event.notification.data.url) {
    try { target = new URL(event.notification.data.url, appURL()).href; } catch (e) {}
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url.indexOf(appURL()) === 0 && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    })
  );
});
