# Fix Keycloak issuer/hostname mismatch (admin console + prod API auth)

**Status:** Approved for planning
**Date:** 2026-08-16

## Problem

Two related bugs, both stemming from the gap between Keycloak's own idea of
its public hostname and the `/auth` path Traefik actually requires to reach
it, found while verifying BGGG-10 (the login-gate feature):

**1. Prod admin console hangs on "Loading the administrator console."**
`docker-compose.prod.yml` sets `KC_HOSTNAME: https://${DOMAIN_NAME}` — no
path. Keycloak uses this to generate every self-referential absolute URL it
emits: admin console JS asset paths, the OIDC discovery document's `issuer`
field, endpoint URLs. Traefik only routes `PathPrefix(`/auth`)` to the
`keycloak` service (`docker-compose.yml`'s labels + StripPrefix
middleware) — everything else falls through to `web`'s catch-all `Host()`
router. Confirmed live against `https://bggg.duckdns.org`: the admin
console's JS bundle is requested at
`/resources/mnl44/admin/keycloak.v2/assets/main-*.js` (no `/auth` prefix),
which Traefik routes to the `web` (Next.js) service instead of Keycloak, so
the bundle never loads and the console spins forever.

**2. Prod API auth would reject every real logged-in user's token.**
`apps/api/src/auth/auth.guard.ts:17-29` computes the issuer it validates
tokens against as `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`, where
`KEYCLOAK_URL` is the container-internal `http://keycloak:8080`
(`docker-compose.yml:240`, used directly container-to-container for the
JWKS fetch, bypassing Traefik). Once bug 1 is fixed, Keycloak will stamp
real tokens with `iss=https://${DOMAIN_NAME}/auth/realms/${KEYCLOAK_REALM}`
— which will never equal `http://keycloak:8080/realms/boardgame`. `jwtVerify`
would reject every genuine token on that mismatch. This is independent of
bug 1 being fixed or not (the mismatch exists either way, just against a
different wrong value). It only "works" in dev today because dev's Keycloak
(`start-dev`, no `KC_HOSTNAME` set) mirrors back whatever host the request
arrived on, and `apps/api`'s `KEYCLOAK_URL` defaults to
`http://localhost:8080` there too — coincidentally consistent, not
correctly designed.

## Goals

- Keycloak's self-generated absolute URLs (admin console assets, OIDC
  issuer/discovery, endpoints) match the path the browser can actually
  reach it at (`https://${DOMAIN_NAME}/auth`) — fixing the admin console
  hang as a side effect of fixing the root cause.
- `AuthGuard` validates real prod tokens against the same public issuer
  value that `apps/web`'s `AUTH_KEYCLOAK_ISSUER` already computes and uses
  (`docker-compose.yml:329`), instead of a container-internal address that
  can never match.
- Dev keeps working unchanged — no new required env var there; `AuthGuard`
  falls back to today's `KEYCLOAK_URL`-derived issuer when the new var is
  unset, which is already correct for dev's no-hostname-pinning setup.

## Non-goals

- Switching from Traefik's StripPrefix approach to
  `KC_HTTP_RELATIVE_PATH=/auth` — already considered and rejected in
  `notes/4_environments.md` (proven pattern, symmetric with `api`'s own
  StripPrefix router, avoids touching `apps/api`'s direct
  `KEYCLOAK_URL=http://keycloak:8080` container-to-container call). This
  fix only changes what `KC_HOSTNAME` computes; Traefik's incoming-request
  handling is untouched.
- Redeploying or otherwise touching the live prod server. This fix changes
  repo config/code only; an actual rollout is a separate, later step for
  the user to trigger via the existing Ansible playbook.
- Changing how `apps/api` fetches JWKS (`KEYCLOAK_URL`, container-internal)
  — that's fine staying internal, it's just fetching public keys and
  doesn't need to round-trip through Traefik. Only the *issuer check*
  value changes.

## Approach

1. `docker-compose.prod.yml`: change `KC_HOSTNAME: https://${DOMAIN_NAME}`
   to `KC_HOSTNAME: https://${DOMAIN_NAME}/auth`. Keycloak 26's hostname
   provider accepts a full URL including a path specifically for this
   "reverse proxy strips a prefix" case; it only affects self-generated
   absolute links, not incoming request matching.
2. `docker-compose.yml`: add `KEYCLOAK_ISSUER:
   https://${DOMAIN_NAME}/auth/realms/${KEYCLOAK_REALM}` to the `api`
   service's `environment:` block — the exact same computed value and
   pattern already used one service down for `web`'s
   `AUTH_KEYCLOAK_ISSUER` (`docker-compose.yml:329`).
3. `apps/api/src/auth/auth.guard.ts`: change `ISSUER` to
   `process.env.KEYCLOAK_ISSUER ?? \`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}\``
   — prod gets the correct explicit public issuer via the new var; dev
   (where `KEYCLOAK_ISSUER` stays unset) keeps its current, already-correct
   fallback behavior unchanged.

## Risks

- If `KEYCLOAK_ISSUER` is ever set to a value that doesn't actually match
  what Keycloak stamps into real tokens (e.g. `KC_HOSTNAME` and
  `KEYCLOAK_ISSUER` drift out of sync in a future edit), `AuthGuard` would
  reject every real token again, the same way it does today — worth a
  comment noting these two values must stay in lockstep.
- This is diagnosed from a live read-only check against
  `https://bggg.duckdns.org`, not from having reproduced a real end-to-end
  prod login — full confidence needs deploying and testing a real login
  afterward, which the user must decide when to trigger.
