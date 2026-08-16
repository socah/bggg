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
});
