import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

// Keycloak is passed uncalled (not Keycloak({...})) — Auth.js calls it
// internally after reading clientId/clientSecret/issuer from the
// AUTH_KEYCLOAK_ID / AUTH_KEYCLOAK_SECRET / AUTH_KEYCLOAK_ISSUER env vars
// (see .env). Nothing secret is written in this file, so it's safe to
// commit — the same reasoning as KEYCLOAK_URL never being hardcoded in
// apps/api/src/auth/auth.guard.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // Default is '/api/auth' — moved so '/api/*' can stay Traefik's and
  // next.config.ts's unconditional "always the NestJS backend" prefix, with
  // no carve-out for Auth.js's own routes. Must match
  // app/web/auth/[...nextauth]/route.ts's location, and
  // infra/keycloak/boardgame-realm.json's 'web' client redirect URI
  // ('.../web/auth/callback/keycloak').
  basePath: '/web/auth',
  providers: [Keycloak],

  callbacks: {
    // Runs on every request that reads the session. `account` is only
    // present on the initial sign-in (the OAuth exchange) — every
    // subsequent call re-reads the persisted JWT and, once the access
    // token has expired, refreshes it via Keycloak's refresh-token grant.
    // Without this, a client-side /api/* call would start failing partway
    // through a session the moment the (short-lived) access token expired.
    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          // account.expires_at is seconds since epoch (OAuth standard),
          // not milliseconds.
          expiresAt: account.expires_at,
        };
      }

      if (typeof token.expiresAt === 'number' && Date.now() < token.expiresAt * 1000) {
        return token;
      }

      try {
        const response = await fetch(
          `${process.env.AUTH_KEYCLOAK_ISSUER}/protocol/openid-connect/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: process.env.AUTH_KEYCLOAK_ID ?? '',
              client_secret: process.env.AUTH_KEYCLOAK_SECRET ?? '',
              refresh_token: token.refreshToken as string,
            }),
          },
        );
        const refreshed = await response.json();
        if (!response.ok) throw refreshed;

        return {
          ...token,
          accessToken: refreshed.access_token,
          // Keycloak may or may not rotate the refresh token itself —
          // fall back to the existing one if it didn't.
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
        };
      } catch {
        // Surfaced on the session as `error` — apps/web/lib/api.ts checks
        // this and forces a sign-out rather than calling the API with a
        // token it knows is dead.
        return { ...token, error: 'RefreshTokenError' as const };
      }
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error as 'RefreshTokenError' | undefined;
      return session;
    },
  },
  // No explicit trustHost here — AUTH_URL (see .env) being set makes
  // @auth/core default config.trustHost to true on its own (its own
  // env.js: 'config.trustHost ?? (config.trustHost = !!(envObject.AUTH_URL
  // ?? ...))'). Without either, Auth.js rejects every request in production
  // with 'UntrustedHost' (reproduced directly: prod logs showed this for
  // every single request before AUTH_URL was set) — that was what was
  // actually causing signIn() to fall back to redirecting at its own
  // (unsupported-for-GET) URL, not a Keycloak/discovery problem.
});

// Module augmentation: next-auth's default Session/JWT types don't know
// about these fields — without this, every read of session.accessToken or
// token.expiresAt above is a TypeScript error.
declare module 'next-auth' {
  interface Session {
    accessToken: string;
    error?: 'RefreshTokenError';
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: 'RefreshTokenError';
  }
}
