'use client';

import { SessionProvider } from 'next-auth/react';

// Auth.js's client helpers (getSession, signOut, useSession) read their
// base path from this provider's config at mount time — auth.ts sets
// basePath: '/web/auth' server-side, so this has to match, or client calls
// silently target the wrong (nonexistent, since '/api' is unconditionally
// the NestJS backend) route.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath="/web/auth">{children}</SessionProvider>;
}
