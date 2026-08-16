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

## `/api` is always the backend; Auth.js lives under `/web`

Both Traefik (`docker-compose.yml`'s `api` router, `PathPrefix('/api')`)
and `apps/web/next.config.ts`'s rewrite treat `/api/*` as an unconditional
"always the NestJS backend" rule — no exceptions, at either layer. Auth.js
(`apps/web/auth.ts`) is therefore configured with `basePath: '/web/auth'`
instead of its default `/api/auth`, and the custom login-redirect route
lives at `apps/web/app/web/login/route.ts`, not `/api/login`. This wasn't
the original design — seeing both layers need their own hand-written
carve-out for two special-cased `/api` paths (Traefik: a more-specific
router per path to win priority over `api`'s router; the rewrite: a
negative-lookahead regex) was the signal that `/api` meaning two
contradictory things was the actual bug, not something to keep patching
around. Moving Auth.js off `/api` entirely removes the need for either
carve-out.

Keycloak's `web` client's redirect URI (`infra/keycloak/boardgame-realm.json`)
must match: `.../web/auth/callback/keycloak`, not `.../api/auth/callback/keycloak`.

## The one-hop login redirect (`apps/web`)

Visiting any gated route while unauthenticated lands the browser on
Keycloak's real hosted login page in one hop, with no intermediate
"click to sign in" page:

1. `apps/web/proxy.ts` — Auth.js's `auth()` wrapper as Next.js middleware.
   For any matched route with no session, it redirects to `/web/login`
   (not Auth.js's own `/web/auth/signin`). `/` itself is included in the
   gate (no special-casing).
2. `apps/web/app/web/login/route.ts` — a Route Handler that calls
   `signIn('keycloak', { redirectTo: callbackUrl })` and returns the
   result, which is a real redirect straight to Keycloak's authorize URL
   (real PKCE `code_challenge` included).

Two non-obvious constraints shaped this design (both were tripped over
directly — see `docs/superpowers/specs/2026-08-16-homepage-login-gate-design.md`):

- **`GET /web/auth/signin/<provider>` is not a supported Auth.js action.**
  `@auth/core`'s page renderer explicitly throws `UnknownAction` for a GET
  with a provider segment — only the provider-less `/web/auth/signin` (a
  page listing providers) is renderable via GET. That's why the redirect
  target is a custom `/web/login` route, not Auth.js's built-in signin URL.
- **`signIn()` needs to set cookies (PKCE state), which Next.js only
  allows from a Server Action or Route Handler** — not middleware, and not
  a plain Server Component render. That's why the redirect logic lives in
  a dedicated Route Handler rather than directly in `proxy.ts` or `page.tsx`.

`proxy.ts`'s matcher excludes `/web/auth`, `/web/login`, and Next.js/PWA
static assets — matching everything else, including `/`.

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

## Traefik's shared `secheaders` middleware must not reach Keycloak's frame policy

`docker-compose.yml`'s `secheaders` middleware sets `X-Frame-Options: DENY`
via a dedicated `frame-deny` middleware, applied to `api`/`web`/`chat`'s
routers but deliberately **not** `keycloak`'s. Keycloak frames itself on
purpose — `login-status-iframe.html` (silent check-sso) is loaded same-origin
by both the admin console and any app using `keycloak-js`'s
`checkLoginIframe`. `DENY` blocks framing unconditionally, including
same-origin, which broke the admin console outright (an uncaught error in
the iframe handshake, surfaced as its own untranslated `somethingWentWrong`
error boundary). `keycloak`'s router keeps only the base `secheaders`
(HSTS + nosniff, no frame policy), falling back to Keycloak's own default
(`X-Frame-Options: SAMEORIGIN`) instead of Traefik overriding it.

## The PWA service worker must not intercept Keycloak's `/auth/*` requests

Keycloak is reverse-proxied under the same origin as `apps/web`, at `/auth`
— a completely separate application that only happens to share a domain.
`next-pwa`'s default `runtimeCaching` rules match by file
extension/destination only (any same-origin `*.js`, any same-origin
non-`/api` page navigation, etc.), with no path scoping — so once the web
app's service worker is installed anywhere on the origin, it also
intercepts Keycloak's own JS/CSS/page requests. Reproduced directly: the
admin console's dynamically-imported `Dashboard` chunk failed to fetch
once the SW was active. `apps/web/next.config.ts` adds an explicit
`NetworkOnly` rule for any path starting with `/auth/`, registered ahead of
the extended defaults (`@ducanh2912/next-pwa` prepends custom
`runtimeCaching` entries before its own), so Keycloak's traffic bypasses
the SW's caching entirely.

## `AUTH_KEYCLOAK_SECRET` / `KEYCLOAK_API_SERVICE_SECRET` in prod

Same chicken-and-egg as dev's setup below, but easy to miss because
nothing fails loudly until someone actually completes a real login: both
secrets are absent from `infra/keycloak/boardgame-realm.json` on purpose
(Keycloak generates them on first import), and `infra/ansible/roles/app_deploy`
only warns, rather than failing, when they're blank in Infisical. If prod
login throws Auth.js's generic "problem with server configuration" error,
check whether `AUTH_KEYCLOAK_SECRET` actually exists in Infisical's
`/ENV_VARS` before looking anywhere else — copy it from the admin console
(**boardgame** realm → Clients → **web** → Credentials) the same way as
dev, once, after Keycloak has booted for the first time.

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
