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
});

const nextConfig: NextConfig = {
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
  async rewrites() {
    return [
      {
        // ':path*' is a wildcard that captures everything after /api/
        // e.g. '/api/groups/42/members' → 'http://localhost:3001/groups/42/members'
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};

// Wrap the base config — withPWA returns a new config object with
// the service worker build step added. Everything in nextConfig is preserved.
export default withPWA(nextConfig);
