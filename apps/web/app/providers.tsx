'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from '@/components/theme-provider';
import { StyleProvider } from '@/components/style-provider';
import { ThemeColorSync } from '@/components/theme-color-sync';

// Auth.js's client helpers (getSession, signOut, useSession) read their
// base path from this provider's config at mount time — auth.ts sets
// basePath: '/web/auth' server-side, so this has to match, or client calls
// silently target the wrong (nonexistent, since '/api' is unconditionally
// the NestJS backend) route.
//
// ThemeColorSync must render inside StyleProvider (not as a sibling) since
// it calls useStyle(), which throws outside a <StyleProvider>.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath="/web/auth">
      <ThemeProvider>
        <StyleProvider>
          <ThemeColorSync />
          {children}
        </StyleProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
