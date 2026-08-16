import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

// withPWA runs at build time: it calls Workbox to generate sw.js and injects
// a tiny auto-registration script into the app bundle. The actual event
// listener logic (install / activate / fetch) lives inside the generated sw.js
// — you don't write those manually here.
const withPWA = withPWAInit({
  // Generated sw.js lands in public/ so Next.js serves it at /sw.js.
  // Service workers must be served from the root of the scope they protect.
  dest: 'public',

  // Disabled in dev — a caching SW would make hot reload invisible.
  disable: process.env.NODE_ENV === 'development',

  // Cache pages as the user navigates so subsequent visits are instant.
  cacheOnFrontEndNav: true,

  // Stale-while-revalidate: serve the cached version immediately,
  // then update the cache in the background for the next visit.
  aggressiveFrontEndNavCaching: true,

  // Keycloak is reverse-proxied under this same origin at '/auth' (see
  // docker-compose.yml's Traefik labels) — a completely separate app that
  // happens to share a domain. The default runtimeCaching rules below match
  // by file extension/destination only, with no path scoping (e.g. any
  // same-origin '*.js' gets StaleWhileRevalidate, any same-origin non-'/api'
  // page navigation gets NetworkFirst) — once this app's service worker is
  // installed anywhere on the origin, it also intercepts Keycloak's own
  // JS/CSS/page requests under '/auth/*'. Reproduced directly: the admin
  // console's dynamically-imported Dashboard chunk failed to fetch after the
  // SW activated. NetworkOnly for '/auth/*' is a plain pass-through — no
  // caching, no rewriting — checked before the extended defaults below
  // (custom entries are prepended ahead of them, see resolveRuntimeCaching
  // in @ducanh2912/next-pwa's own source), so it always wins for this prefix
  // regardless of extension.
  runtimeCaching: [
    {
      urlPattern: ({ url }) => url.pathname.startsWith('/auth/'),
      handler: 'NetworkOnly',
    },
  ],
  extendDefaultRuntimeCaching: true,
});

const nextConfig: NextConfig = {
  // Decision: 'standalone' output traces only the files this app actually
  // needs at runtime (its own code + the specific node_modules it
  // imports) into .next/standalone, instead of the production image
  // needing the full workspace node_modules copied in. Alternative: copy
  // the whole pruned node_modules like apps/api's Dockerfile does.
  // Drawback of that here: apps/web's tree includes React/Next.js's own
  // considerable weight, so tracing (already built into Next) is worth
  // using rather than skipping.
  output: 'standalone',

  // Rewrites are URL transformations that happen on the Next.js server,
  // invisible to the browser. The browser sends '/api/groups', Next.js
  // forwards it to the NestJS backend and returns the response —
  // the browser never sees the backend's real address.
  //
  // Why this matters:
  //   1. No CORS: browser and API share the same origin (localhost:3000)
  //   2. One place to change the backend URL (env var, not scattered fetches)
  //   3. In production, Traefik will do this routing instead — same contract,
  //      different implementation.
  //
  // Array-form rewrites run as "afterFiles" — after static/page files are
  // checked, but before Next's own dynamic app routes (like the catch-all
  // app/api/auth/[...nextauth]/route.ts). Without the negative lookahead
  // below, '/api/auth/*' matches this rewrite first and gets proxied to
  // the NestJS backend, so Auth.js's own routes (signin, callback,
  // session, csrf) never run at all.
  async rewrites() {
    return [
      {
        // ':path*' is a wildcard that captures everything after /api/
        // e.g. '/api/groups/42/members' → 'http://localhost:3001/groups/42/members'
        // The '(?!auth/|auth$)' lookahead excludes '/api/auth' and
        // '/api/auth/*' so those fall through to Auth.js's own route.
        source: '/api/:path((?!auth/|auth$).*)',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};

// Wrap the base config — withPWA returns a new config object with
// the service worker build step added. Everything in nextConfig is preserved.
export default withPWA(nextConfig);
