# Authentication & Keycloak

Living reference for how login works end-to-end, across `apps/web`,
`apps/api`, and Keycloak. Describes current behavior — for the history of
*why* it looks like this, see the dated specs in `docs/superpowers/specs/`
that introduced each piece (linked inline below).

## Overview

Keycloak is the identity provider. Auth.js (`next-auth` v5) in `apps/web`
drives the OAuth Authorization Code + PKCE flow. `apps/api`'s `AuthGuard`
independently verifies the resulting JWTs via Keycloak's JWKS — it never
talks to Auth.js.

## The one-hop login redirect (`apps/web`)

Visiting any gated route while unauthenticated lands the browser on
Keycloak's real hosted login page in one hop, with no intermediate
"click to sign in" page:

1. `apps/web/proxy.ts` — Auth.js's `auth()` wrapper as Next.js middleware.
   For any matched route with no session, it redirects to `/api/login`
   (not Auth.js's own `/api/auth/signin`). `/` itself is included in the
   gate (no special-casing).
2. `apps/web/app/api/login/route.ts` — a Route Handler that calls
   `signIn('keycloak', { redirectTo: callbackUrl })` and returns the
   result, which is a real redirect straight to Keycloak's authorize URL
   (real PKCE `code_challenge` included).

Two non-obvious constraints shaped this design (both were tripped over
directly — see `docs/superpowers/specs/2026-08-16-homepage-login-gate-design.md`):

- **`GET /api/auth/signin/<provider>` is not a supported Auth.js action.**
  `@auth/core`'s page renderer explicitly throws `UnknownAction` for a GET
  with a provider segment — only the provider-less `/api/auth/signin` (a
  page listing providers) is renderable via GET. That's why the redirect
  target is a custom `/api/login` route, not Auth.js's built-in signin URL.
- **`signIn()` needs to set cookies (PKCE state), which Next.js only
  allows from a Server Action or Route Handler** — not middleware, and not
  a plain Server Component render. That's why the redirect logic lives in
  a dedicated Route Handler rather than directly in `proxy.ts` or `page.tsx`.

`proxy.ts`'s matcher excludes `/api/auth`, `/api/login`, and Next.js/PWA
static assets — matching everything else, including `/`.

## The `next.config.ts` backend rewrite and `/api/auth`, `/api/login`

`apps/web/next.config.ts` rewrites `/api/*` to the NestJS backend so the
browser and API share an origin. That rewrite runs as an "afterFiles"
rewrite — checked *before* Next's own **dynamic** app routes (like the
catch-all `app/api/auth/[...nextauth]/route.ts`), but *after* **static**
app routes (like `app/api/login/route.ts`, which needs no special
exclusion — it already wins over the rewrite as a plain filesystem route).
The rewrite's `source` therefore explicitly excludes `/api/auth` via a
negative-lookahead regex (`/api/:path((?!auth/|auth$).*)`) so Auth.js's own
dynamic routes (signin, callback, session, csrf) aren't silently proxied to
the backend instead of running.

## Keycloak hostname / issuer consistency (prod)

Keycloak sits behind Traefik at the `/auth` path prefix
(`PathPrefix('/auth')` + StripPrefix middleware in `docker-compose.yml`) —
Traefik strips `/auth` before forwarding, so Keycloak's own *incoming*
request handling stays unaware of the prefix entirely. But Keycloak also
generates *outgoing* self-referential absolute URLs (the OIDC `issuer`,
admin console asset paths, endpoint URLs) from `KC_HOSTNAME`
(`docker-compose.prod.yml`) — and those must include `/auth`, or the
browser follows a link Traefik won't route to Keycloak at all (this is
exactly what caused the admin console to hang on "Loading the
administrator console" — see
`docs/superpowers/specs/2026-08-16-keycloak-issuer-hostname-fix-design.md`).

Three values must stay in lockstep:

| Var | Where | Value (prod) |
|---|---|---|
| `KC_HOSTNAME` | `docker-compose.prod.yml`, `keycloak` service | `https://${DOMAIN_NAME}/auth` |
| `AUTH_KEYCLOAK_ISSUER` | `docker-compose.yml`, `web` service | `https://${DOMAIN_NAME}/auth/realms/${KEYCLOAK_REALM}` |
| `KEYCLOAK_ISSUER` | `docker-compose.yml`, `api` service | `https://${DOMAIN_NAME}/auth/realms/${KEYCLOAK_REALM}` |

`apps/api/src/auth/auth.guard.ts` validates real tokens' `iss` claim
against `KEYCLOAK_ISSUER` (falling back to a `KEYCLOAK_URL`-derived value
only when unset, e.g. in dev). It still fetches JWKS via the
container-internal `KEYCLOAK_URL` (`http://keycloak:8080`) directly,
bypassing Traefik — that's fine, it's just fetching public keys and
doesn't need to resolve through the public hostname.

Dev has none of this pinning: `start-dev` mirrors back whatever host the
request arrived on, so a plain `http://localhost:8080` works without any
`KC_HOSTNAME`/`KEYCLOAK_ISSUER` config at all.

## Local dev setup

- `docker compose up -d db keycloak` (needs a root `.env` — copy from
  `.env.example` — since `docker-compose.dev.yml` alone has no
  `image`/`build` for every service; `COMPOSE_FILE` in `.env` merges the
  base + dev override automatically).
- `AUTH_KEYCLOAK_SECRET` isn't in the realm export on purpose (Keycloak
  generates it fresh per import) — copy it from the admin console
  (`http://localhost:8080` → **boardgame** realm → Clients → web →
  Credentials) into `apps/web/.env.local`.
- No seed user exists (`registrationAllowed: false`, no regular users in
  `infra/keycloak/boardgame-realm.json`) — create one via the admin
  console or Admin REST API before testing a real login.
- Verifying the full login round trip (submitting real credentials into
  Keycloak's hosted form) is unreliable via `curl` — the modern
  `keycloak.v2` theme appears to depend on browser JS/cookie behavior a
  static HTML/curl reconstruction can't replicate. Use a real browser (or
  a browser-automation tool) for that last step; everything up to and
  including the real redirect to Keycloak's authorize endpoint is
  reliably `curl`-testable.

## Prod admin console

`https://bggg.duckdns.org/auth/admin/master/console/` — log in with
`KEYCLOAK_ADMIN_USER`/`KEYCLOAK_ADMIN_PASSWORD` (Infisical), then switch
the realm dropdown to **boardgame**.
