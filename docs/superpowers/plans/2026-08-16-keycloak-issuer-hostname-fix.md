# Fix Keycloak Issuer/Hostname Mismatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prod's Keycloak generates self-referential URLs (admin console assets, OIDC issuer) that match the `/auth` path Traefik actually routes to it, and `apps/api`'s `AuthGuard` validates real tokens against that same public issuer instead of a container-internal address that can never match.

**Architecture:** Three small, tightly-coupled edits — a Keycloak hostname config value, a new env var carrying the public issuer for `apps/api` (mirroring the pattern `apps/web` already uses), and `AuthGuard` preferring that var over its current container-internal derivation. No new services, no new files except one test file.

**Tech Stack:** Docker Compose (YAML env interpolation), NestJS (`AuthGuard`, `jose` for JWT verification), Jest.

**Spec:** `docs/superpowers/specs/2026-08-16-keycloak-issuer-hostname-fix-design.md`

## Global Constraints

- Do not switch to `KC_HTTP_RELATIVE_PATH=/auth` — Traefik's StripPrefix approach stays; only `KC_HOSTNAME`'s value changes (spec Non-goals).
- Do not touch how `apps/api` fetches JWKS (`KEYCLOAK_URL`, container-internal, bypasses Traefik) — only the issuer-check value changes (spec Non-goals).
- Dev must keep working with zero new required env vars there — `AuthGuard` falls back to its current `KEYCLOAK_URL`-derived issuer when `KEYCLOAK_ISSUER` is unset (spec Goals).
- This task changes repo files only. No redeploy, no touching the live `bggg.duckdns.org` server (spec Non-goals) — that is a separate, later, user-triggered step.

---

### Task 1: Fix KC_HOSTNAME, add KEYCLOAK_ISSUER, and make AuthGuard use it

**Files:**
- Modify: `docker-compose.prod.yml:15`
- Modify: `docker-compose.yml:240-243` (the `api` service's `environment:` block)
- Modify: `apps/api/src/auth/auth.guard.ts:25-29`
- Test: `apps/api/src/auth/auth.guard.spec.ts` (new)

**Interfaces:**
- Consumes: nothing from other tasks — this is the only task in this plan.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/auth.guard.spec.ts`. This tests only the
`ISSUER`-selection logic (which env var wins), not JWKS/`jwtVerify` (that
needs a live or mocked JWKS endpoint and is explicitly out of scope per the
spec's Non-goals). `KEYCLOAK_URL`/`ISSUER` are computed once at module load
from `process.env`, so each case resets Jest's module registry and
re-imports with different env vars set first.

```typescript
describe('auth.guard ISSUER selection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses KEYCLOAK_ISSUER verbatim when set', async () => {
    process.env.KEYCLOAK_ISSUER =
      'https://bggg.duckdns.org/auth/realms/boardgame';
    process.env.KEYCLOAK_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_REALM = 'boardgame';

    const mod = await import('./auth.guard');
    expect(mod.ISSUER).toBe('https://bggg.duckdns.org/auth/realms/boardgame');
  });

  it('falls back to the KEYCLOAK_URL-derived issuer when KEYCLOAK_ISSUER is unset', async () => {
    delete process.env.KEYCLOAK_ISSUER;
    process.env.KEYCLOAK_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'boardgame';

    const mod = await import('./auth.guard');
    expect(mod.ISSUER).toBe('http://localhost:8080/realms/boardgame');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx jest auth.guard.spec.ts`
Expected: FAIL — `ISSUER` is not exported from `./auth.guard` yet (the
current file only has an unexported top-level `const ISSUER`).

- [ ] **Step 3: Export ISSUER and change its computation in `auth.guard.ts`**

In `apps/api/src/auth/auth.guard.ts`, replace lines 25-29:

```typescript
// The issuer every valid token must claim. Checked explicitly below so a
// token signed by a *different* realm on the same Keycloak instance (or a
// different Keycloak entirely) is rejected even if it were somehow otherwise
// well-formed.
const ISSUER = `${KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;
```

with:

```typescript
// The issuer every valid token must claim. Checked explicitly below so a
// token signed by a *different* realm on the same Keycloak instance (or a
// different Keycloak entirely) is rejected even if it were somehow otherwise
// well-formed.
//
// KEYCLOAK_ISSUER (when set) takes priority over deriving the issuer from
// KEYCLOAK_URL: in prod, KEYCLOAK_URL is the container-internal
// http://keycloak:8080 address (used for the JWKS fetch above, which is
// fine staying internal), but real tokens carry Keycloak's public-facing
// issuer (https://<domain>/auth/realms/<realm> — see docker-compose.yml's
// KC_HOSTNAME/KEYCLOAK_ISSUER, which must stay in lockstep with this).
// Those two are never the same value in prod, so deriving from
// KEYCLOAK_URL there would reject every real token. Dev leaves
// KEYCLOAK_ISSUER unset and keeps today's KEYCLOAK_URL-derived behavior,
// which is already correct there (no reverse-proxy hostname pinning).
export const ISSUER =
  process.env.KEYCLOAK_ISSUER ??
  `${KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx jest auth.guard.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full apps/api test suite to confirm nothing else broke**

Run: `cd apps/api && npm run test`
Expected: PASS (exporting a previously-internal constant and adding a
fallback for an already-unset dev var should not affect any other test).

- [ ] **Step 6: Fix `KC_HOSTNAME` in `docker-compose.prod.yml`**

Change line 15 from:

```yaml
      KC_HOSTNAME: https://${DOMAIN_NAME}
```

to:

```yaml
      KC_HOSTNAME: https://${DOMAIN_NAME}/auth
```

- [ ] **Step 7: Add `KEYCLOAK_ISSUER` to the `api` service in `docker-compose.yml`**

In the `api` service's `environment:` block, immediately after the existing
`KEYCLOAK_URL`/`KEYCLOAK_REALM` lines (currently lines 240-241):

```yaml
      KEYCLOAK_URL: http://keycloak:8080
      KEYCLOAK_REALM: ${KEYCLOAK_REALM}
      # Public-facing issuer AuthGuard validates real tokens against — see
      # auth.guard.ts's ISSUER comment. Must stay in lockstep with
      # docker-compose.prod.yml's keycloak KC_HOSTNAME (same
      # https://<domain>/auth base) and mirrors the identical pattern
      # already used for 'web's AUTH_KEYCLOAK_ISSUER below.
      KEYCLOAK_ISSUER: https://${DOMAIN_NAME}/auth/realms/${KEYCLOAK_REALM}
```

- [ ] **Step 8: Validate the compose files parse correctly**

Run: `docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet`
Expected: no output, exit code 0 (confirms valid YAML and that
`${DOMAIN_NAME}`/`${KEYCLOAK_REALM}` interpolation isn't broken — a missing
`.env`/`.env.prod` value would only warn, not fail, so this just checks
syntax, not real values).

- [ ] **Step 9: Commit**

```bash
git add docker-compose.prod.yml docker-compose.yml apps/api/src/auth/auth.guard.ts apps/api/src/auth/auth.guard.spec.ts
git commit -m "fix: make Keycloak's public hostname and AuthGuard's issuer check consistent"
```

---

## Self-Review Notes

- **Spec coverage:** bug 1 (admin console / self-referential URLs) — Step 6.
  Bug 2 (AuthGuard issuer mismatch) — Steps 3-4, with Step 7 supplying the
  prod value it reads. Dev-unaffected goal — Step 3's fallback branch,
  tested explicitly in Step 1's second case. Non-goals (no
  `KC_HTTP_RELATIVE_PATH` switch, no JWKS-fetch change, no redeploy) — none
  of the steps touch those.
- **Placeholder scan:** no TBD/TODO; every step has literal file content.
- **Type consistency:** `ISSUER` is now exported (`export const ISSUER`) —
  the only consumer within this plan is the new spec file's `mod.ISSUER`,
  matching the export name used in Step 1's test and Step 3's change.
