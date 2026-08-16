# Gate homepage behind Keycloak login

**Status:** Approved for planning
**Date:** 2026-08-16

## Problem

Visiting bggg.duckdns.com always renders the static "Select or create a
group to get started" placeholder in `apps/web/app/page.tsx`, regardless of
whether the visitor is logged in. `auth.ts` already configures NextAuth
(Auth.js) with the Keycloak provider, and `/api/auth/[...nextauth]` exists,
but nothing in the app actually reads the session:

- `page.tsx` is a hardcoded Server Component with no `auth()` call.
- There is no `middleware.ts`, so no route is gated.
- There is no sign-in UI (button/link) anywhere.

## Goals

- Unauthenticated visitors to `/` are redirected to Keycloak sign-in.
- Authenticated visitors see the existing homepage content.
- Use Auth.js's own session/redirect primitives (`auth()`, `signIn()`) rather
  than hand-rolling JWT/cookie checks — the API side's JWKS verification
  (`apps/api/src/auth/auth.guard.ts`) is a separate, already-solved concern
  and is out of scope here.

## Non-goals

- Building out the real "select or create a group" UI/data-fetching (fetching
  groups from the NestJS API). That's the next roadmap topic per the comment
  already in `page.tsx`; this feature only adds the auth gate around the
  existing placeholder.
- A dedicated custom-styled login page. Keycloak's own hosted login page is
  used as-is (that's the whole point of Decision 1/3 in `notes/3_keycloak.md`
  — Next.js redirects to Keycloak's hosted UI).
- Sign-out UI. Can follow as a separate small task once the gate exists.

## Approach

Add a `middleware.ts` at `apps/web/` (Auth.js recommends gating in
middleware over per-page checks, since it runs before rendering and covers
future routes automatically) that:

1. Wraps the existing `auth` export from `auth.ts` as the middleware export
   (Auth.js's standard `export { auth as middleware } from './auth'` pattern,
   extended with a callback to redirect to Keycloak sign-in when there's no
   session).
2. Applies to `/` (and, via the matcher, future authenticated routes) while
   excluding `/api/auth/*` and static assets so the auth flow itself and
   Next.js internals aren't gated.

`page.tsx` itself doesn't need an explicit `auth()` check once middleware
redirects unauthenticated requests — but as defense-in-depth and to reflect
this is the "you're logged in" page, it's worth confirming this is intended
either as middleware-only or belt-and-suspenders during planning.

## Risks

- Middleware runs on the Edge runtime by default — need to confirm Auth.js's
  Keycloak provider config works there, or configure the Node.js runtime
  explicitly if not.
- Redirect loop risk if the matcher isn't scoped correctly (must exclude the
  NextAuth API routes and the Keycloak callback path).
