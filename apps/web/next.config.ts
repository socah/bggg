import type { NextConfig } from 'next';

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

export default nextConfig;
