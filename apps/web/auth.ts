import NextAuth from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

// Keycloak is passed uncalled (not Keycloak({...})) — Auth.js calls it
// internally after reading clientId/clientSecret/issuer from the
// AUTH_KEYCLOAK_ID / AUTH_KEYCLOAK_SECRET / AUTH_KEYCLOAK_ISSUER env vars
// (see .env). Nothing secret is written in this file, so it's safe to
// commit — the same reasoning as KEYCLOAK_URL never being hardcoded in
// apps/api/src/auth/auth.guard.ts.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Keycloak],
});
