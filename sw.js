/* Emma Study service worker.
   App-shell caching (cache-first, versioned) + web push notifications.
   API traffic (Supabase) is never intercepted for caching — those
   requests always go straight to the network, untouched. */

var CACHE_NAME = "emma-study-shell-v4";

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
  /* No skipWaiting() here on purpose: when a previous worker is
     still controlling the app, this worker WAITS so the page's
     Refresh control can offer the update and activate it on tap
     (via the SKIP_WAITING message below) instead of swapping the
     shell out from under an in-progress study session. A first
     install has no controller to wait for and activates at once. */
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES.map(shellURL));
    })
  );
});

/* The page's Refresh / "Update now" control posts this when the
   person chooses to take a waiting update. */
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
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
