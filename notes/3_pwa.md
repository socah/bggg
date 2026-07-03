# PWA Setup — Manifest, Service Worker, Android Install, Offline Basics

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** 3_pwa
**Date:** 2026-07-03
**SecOps:** No

---

## What Is This?

A Progressive Web App (PWA) is a regular web app that opts into a set of browser APIs — primarily a **Web App Manifest** and a **Service Worker** — that make it behave more like a native app. The manifest tells the browser metadata about your app (name, icon, theme colour, how to display it). The service worker is a JavaScript file that runs in the background, separate from the main page, and can intercept network requests, cache responses, and work offline.

The key insight: a PWA is not a different kind of app. It is a web app with a few extra files that unlock install-to-homescreen, push notifications, and offline capability.

---

## Why Does It Matter for This Project?

The board game group platform's primary users are people around a table pulling out their phones to record a play result or check who is coming to next week's session. They need an experience that feels native — one-tap launch from the home screen, fast loading even on spotty café WiFi — without requiring an App Store submission or a React Native build pipeline.

---

## The Decision

Chose: **Next.js built-in PWA support via `next-pwa` wrapper around Workbox**
Because: Workbox handles the hard parts of service worker caching strategy selection; `next-pwa` wires it automatically into the Next.js build so the service worker regenerates on each production build.
Alternative: Hand-writing the service worker from scratch
Drawback of alternative: Correctly handling cache versioning, background sync, and the service worker update lifecycle is genuinely subtle — easy to create a situation where users are stuck on a stale cache forever.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version that isolates just this concept so you can see it clearly.

### Scenario

A minimal static website for a café menu. We want it to:
1. Be installable on Android ("Add to Home Screen")
2. Load the menu even when offline

### Code / Configuration

**`/public/manifest.json`**
```json
{
  "name": "Corner Café",
  "short_name": "Café",
  "description": "Our daily menu",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#6f4e37",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

**`/public/sw.js`** (hand-written, simplified)
```js
const CACHE_NAME = 'cafe-v1';

// Install: pre-cache the shell
self.addEventListener('install', event => {
  // waitUntil keeps the SW in "installing" state until the cache is populated.
  // If the promise rejects, the SW is discarded — safe fail.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(['/index.html', '/menu.json', '/icons/icon-192.png'])
    )
  );
  // Skip the waiting phase so the new SW activates immediately.
  self.skipWaiting();
});

// Activate: delete caches from previous versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME) // anything that isn't our current cache
          .map(key => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs immediately, not just new ones.
  self.clients.claim();
});

// Fetch: cache-first for our own assets, network-first for everything else
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;           // serve from cache if we have it
      return fetch(event.request);         // otherwise hit the network
    })
  );
});
```

**`/index.html`** (the link tags that connect the manifest and register the SW)
```html
<head>
  <!-- Tells the browser this app has a manifest -->
  <link rel="manifest" href="/manifest.json" />
  <!-- Theme colour for the browser chrome on mobile -->
  <meta name="theme-color" content="#6f4e37" />
</head>
<script>
  // Service workers can only be registered from JS, not from HTML attributes.
  // The 'load' event ensures registration happens after the page is interactive.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js');
    });
  }
</script>
```

### What Is Happening Step by Step

1. **Manifest link:** The browser fetches `/manifest.json` when the page loads. This is how it learns the app's name, icons, and `display: "standalone"` (which means: when launched from the home screen, show no browser chrome — no address bar, no back button — making it feel native).

2. **`start_url: "/"`:** When the user taps the icon on their home screen, the browser opens exactly this URL. If you set it to `"/?source=pwa"` you can distinguish home-screen traffic in analytics.

3. **Service worker registration:** `navigator.serviceWorker.register('/sw.js')` tells the browser to download, parse, and run `sw.js` in a background thread. The SW has no access to the DOM — it only intercepts network requests.

4. **Install event:** Fires the first time the SW is registered (or when a new version is detected). `cache.addAll([...])` pre-populates the cache. `skipWaiting()` means: don't wait for existing tabs to close before activating — the new SW activates immediately on next page load.

5. **Activate event:** Fires after install. We delete old caches here — if we didn't, `cafe-v1` would grow indefinitely as users update. `clients.claim()` lets the newly activated SW control open tabs without a reload.

6. **Fetch event:** Every network request made by the page passes through here. The cache-first strategy: check the cache, return immediately if found, only hit the network if not cached. This is what makes the page load offline.

### What Would Break If You Changed X?

If you removed `self.skipWaiting()` from the install handler: the new service worker would install but sit in a "waiting" state. Users already on the site would keep using the old SW until they close all tabs and reopen the app. A common source of "why is my update not showing up?" bugs.

---

## Now Apply It

In this project, the PWA config lives in the Next.js app. `next-pwa` generates the service worker at build time using Workbox under the hood, so you don't write `sw.js` manually.

Files to look at after this note:
- `frontend/next.config.ts` — where `next-pwa` is configured (cache strategies, SW output path)
- `frontend/public/manifest.json` — the manifest we'll create (same fields as the worked example)
- `frontend/app/layout.tsx` — where the `<link rel="manifest">` and `<meta name="theme-color">` tags live

---

## Checkpoint Questions

1. What is the difference between `display: "standalone"` and `display: "browser"` in the manifest, and why does it matter for a board game group app?
2. A user installs the app on their Android phone. Three weeks later you push an update. Walk me through exactly how and when the service worker update reaches them.
3. What is the purpose of `self.clients.claim()` in the activate handler? What would the user experience be without it?
4. Why does `next-pwa` use Workbox instead of a hand-written service worker? What does Workbox add?
5. If the manifest's icon is missing the 512×512 size, what specific Android behaviour breaks?

---

## Summary

Built: PWA setup for the Next.js app — `@ducanh2912/next-pwa` installed, `next.config.ts` wrapped with `withPWA`, `public/manifest.json` created, placeholder icons generated, and `app/layout.tsx` updated with `metadata.manifest` and `viewport.themeColor`.

Demonstrated understanding of: The SW update lifecycle — install → waiting (blocked by old SW's live clients) → activate → cache cleanup; why `skipWaiting()` and `clients.claim()` exist; that a page reload is still required for users to see new code even after the SW updates.

To revisit: The distinction between `manifest.json` `theme_color` (installed PWA / splash screen) and `<meta name="theme-color">` (browser tab) — user had these swapped initially. Also worth revisiting the maskable icon safe zone concept before shipping real icons.
