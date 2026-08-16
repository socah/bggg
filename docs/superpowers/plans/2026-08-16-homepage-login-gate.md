# Gate Homepage Behind Keycloak Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unauthenticated visitors to `bggg.duckdns.com` (and dev's `localhost:3000`) are redirected to Keycloak sign-in; authenticated visitors see the existing homepage placeholder unchanged.

**Architecture:** Add a single `apps/web/middleware.ts` using Auth.js v5's `auth()` wrapper. It checks `req.auth` (the session, populated by the JWT session cookie) and redirects to Auth.js's own `/api/auth/signin/keycloak` route when absent, preserving the originally requested URL as `callbackUrl` so the user lands back where they started after logging in. A `matcher` config excludes `/api/auth/*`, Next.js internals, and PWA/static assets so the sign-in flow and asset requests are never gated. `page.tsx` is not modified — gating happens entirely in middleware, before the page renders.

**Tech Stack:** Next.js 16 (App Router), next-auth (Auth.js) v5 beta with the Keycloak provider, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-16-homepage-login-gate-design.md`

## Global Constraints

- Use Auth.js's own `auth()`/session primitives for the redirect decision — no hand-rolled JWT/cookie parsing (spec Goals).
- Do not change `apps/web/app/page.tsx`'s placeholder content — the "select or create a group" UI/data work is explicitly out of scope (spec Non-goals).
- Do not build a custom login page — redirect to Keycloak's own hosted login via Auth.js's existing `/api/auth/signin/keycloak` route (spec Non-goals).
- `apps/web` has no test runner configured (no Jest/Vitest/Playwright in `package.json`) — verification in this plan is manual, via the dev server and `curl`/browser, not automated tests. Adding a test framework is out of scope for this feature.

---

### Task 1: Add auth-gating middleware

**Files:**
- Create: `apps/web/middleware.ts`
- Modify: none (verification only) `apps/web/app/page.tsx`

**Interfaces:**
- Consumes: `auth` exported from `apps/web/auth.ts:10` (`export const { handlers, auth, signIn, signOut } = NextAuth({ providers: [Keycloak] })`).
- Produces: nothing consumed by later tasks — this is the only task in this plan.

- [ ] **Step 1: Write `apps/web/middleware.ts`**

```typescript
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Auth.js wraps this callback: `req.auth` is the decoded session (or null)
// from the session cookie, checked before the request reaches any page.
// This never calls Keycloak itself — it only reads the already-issued
// session cookie, so it's safe to run for every matched request.
export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL('/api/auth/signin/keycloak', req.nextUrl.origin);
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  // Matches everything except: the NextAuth API routes themselves (or
  // sign-in becomes an infinite redirect loop), Next.js internals, and
  // the PWA/static assets emitted by next-pwa (sw.js, workbox-*.js,
  // manifest.json) which must load unauthenticated for the app shell to work.
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.json|sw\\.js|workbox-.*\\.js).*)',
  ],
};
```

- [ ] **Step 2: Confirm `AUTH_KEYCLOAK_*` env vars are set for local dev**

Check `apps/web/.env` (or wherever the dev env is loaded) has non-empty
values for `AUTH_KEYCLOAK_ID`, `AUTH_KEYCLOAK_SECRET`, `AUTH_KEYCLOAK_ISSUER`,
and `AUTH_SECRET` (Auth.js's own session-signing secret). Per
`.env.example`, `AUTH_KEYCLOAK_SECRET` must be copied from the Keycloak
admin console the first time the realm is imported — it is blank in
`.env.example` on purpose. Without this, `auth()` will throw at request time
rather than redirecting.

- [ ] **Step 3: Start Keycloak and the web app**

```bash
docker compose -f docker-compose.dev.yml up -d keycloak
cd apps/web && npm run dev
```

Expected: Next.js dev server comes up on `http://localhost:3000` with no
startup errors from `middleware.ts` (a bad env var or import error here
surfaces as a 500 on first request, checked in Step 4).

- [ ] **Step 4: Verify the unauthenticated redirect manually**

```bash
curl -i http://localhost:3000/ | head -20
```

Expected: `HTTP/1.1 307 Temporary Redirect` (or 302) with a `location`
header pointing at `http://localhost:3000/api/auth/signin/keycloak?callbackUrl=%2F`.
If instead you get a 200 with the placeholder HTML, the middleware isn't
matching `/` — recheck the `matcher` regex in Step 1.

- [ ] **Step 5: Verify the authenticated path in a browser**

Open `http://localhost:3000/` in a browser. Expected: redirected to
Keycloak's hosted login page (not a Next.js-rendered page — the URL bar
should show `localhost:8080/realms/boardgame/...`). Log in with a test user
from `infra/keycloak/boardgame-realm.json`. Expected: browser lands back on
`http://localhost:3000/` showing "Board Game Group" / "Select or create a
group to get started" — the existing `page.tsx` content, unchanged.

- [ ] **Step 6: Verify `/api/auth/*` itself is never gated**

```bash
curl -i http://localhost:3000/api/auth/providers | head -5
```

Expected: `HTTP/1.1 200 OK` with a JSON body listing the `keycloak`
provider — confirming the matcher's negative lookahead excludes
`/api/auth/*` and there's no redirect loop.

- [ ] **Step 7: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat(web): redirect unauthenticated visitors to Keycloak login"
```

---

## Execution Notes (deviations from plan)

- **File is `proxy.ts`, not `middleware.ts`.** During verification, `next dev`
  emitted: *"The 'middleware' file convention is deprecated. Please use
  'proxy' instead."* This Next.js version (16.3.1) auto-writes an
  `apps/web/AGENTS.md`/`CLAUDE.md` pair on every `next dev` run warning that
  this release has breaking changes from training-data-era Next.js — this is
  one of them. Renamed `middleware.ts` → `proxy.ts` (same `export default
  auth((req) => {...})` + `export const config = { matcher: [...] }` shape;
  only the filename convention changed). Verified: no deprecation warning,
  redirect behavior identical.
- **Found and fixed a real pre-existing bug in `apps/web/next.config.ts`
  while verifying Step 6.** The `/api/:path*` rewrite to the NestJS backend
  is applied as an "afterFiles" rewrite, which Next.js checks *before*
  dynamic app routes like `app/api/auth/[...nextauth]/route.ts`. That meant
  every request under `/api/auth/*` — including the very sign-in redirect
  this feature adds — was being proxied to the NestJS backend (and failing
  with ECONNREFUSED) instead of ever reaching Auth.js's own route. Fixed by
  scoping the rewrite's `source` to `/api/:path((?!auth/|auth$).*)`, a
  negative-lookahead that excludes `/api/auth` and `/api/auth/*` from the
  proxy so they fall through to the dynamic route. Verified via
  `curl http://localhost:3000/api/auth/providers` and `.../csrf` returning
  real Auth.js JSON instead of a proxy error.
- **Verified (dev server, no live Keycloak):** `tsc --noEmit` clean, `eslint`
  clean on the new/changed files, `GET /` → `307` to
  `/api/auth/signin/keycloak?callbackUrl=%2F`, `/api/auth/providers` and
  `/api/auth/csrf` return real Auth.js responses (not proxied/gated).
- **Not verified (no live Keycloak instance or browser in this environment):**
  the actual hosted-login round trip and confirming `page.tsx` renders for a
  real authenticated session. This should be checked manually against a
  running `docker compose -f docker-compose.dev.yml up keycloak` stack with
  real `AUTH_KEYCLOAK_SECRET` before considering this fully done end-to-end.

## Self-Review Notes

- **Spec coverage:** "Unauthenticated → redirect" (Step 1/4), "authenticated → see homepage unchanged" (Step 5, `page.tsx` untouched), "use Auth.js primitives not hand-rolled checks" (Step 1 uses `auth()` wrapper only), "`/api/auth/*` and static assets excluded" (matcher in Step 1, verified Step 6) are all covered. The spec's two Risks (Edge runtime compatibility, redirect-loop) are directly exercised by Steps 3–4 and Step 6 respectively.
- **Non-goals respected:** no changes to `page.tsx`'s group-fetching UI, no custom login page (redirects to Keycloak's own hosted UI via the existing `/api/auth/signin/keycloak` route), no sign-out UI added.
- No automated test step is included because `apps/web` has no test runner today (see Global Constraints) — if the user wants this codified as an automated test later, that's a separate task to first add Playwright (or similar) to `apps/web`.
