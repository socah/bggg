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
  // Auth.js refuses every request in production unless it knows which host
  // to trust — either a fixed AUTH_URL, or this. Reproduced directly: prod
  // logs showed '[auth][error] UntrustedHost: Host must be trusted' for
  // every request, which is what was actually causing signIn() to fall
  // back to redirecting at its own (unsupported-for-GET) URL, not a
  // Keycloak/discovery problem. Safe here specifically because Traefik's
  // Host(`${DOMAIN_NAME}`) router rule (docker-compose.yml) already only
  // ever forwards requests for the real domain to this container — 'web'
  // never sees an arbitrary/spoofed Host header from the open internet for
  // this to blindly trust.
  trustHost: true,
});
