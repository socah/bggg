# Keycloak Integration — Realm Setup, Client Config, JWT Flow End-to-End

**Phase:** 3 — Core Features
**Topic ID:** `3_keycloak`
**Date:** 2026-06-30
**SecOps:** Yes

---

## What Is This?

Keycloak is an open-source **identity provider (IdP)** — a separate service
whose only job is to know who your users are: their passwords, their email
addresses, whether their account is locked, and how to issue proof of identity
once they've logged in. That "proof of identity" is a **JWT (JSON Web
Token)** — a signed, tamper-evident blob your API can check without ever
calling Keycloak back.

Inside Keycloak, a **realm** is an isolated tenant — its own set of users,
roles, and settings, totally separate from any other realm on the same
Keycloak instance. A **client** is a registration *within* a realm for one
application that's allowed to ask Keycloak for tokens (your Next.js frontend
is one client). The **JWT flow** is the sequence of redirects and token
exchanges that gets a user from "clicks Login" to "Next.js holds a valid
access token" to "NestJS trusts that token without asking Keycloak."

---

## Why Does It Matter for This Project?

Right now `AuthGuard` (`apps/api/src/auth/auth.guard.ts`) verifies tokens with
`jwt.verify(token, process.env.JWT_SECRET!)` — a single shared HMAC secret
that something on your team would have had to mint these tokens with in the
first place. Nothing actually issues those tokens yet; there's no login page,
no password storage, no registration flow. Keycloak fills that entire gap,
and it changes *how* `AuthGuard` verifies tokens too: instead of one shared
secret, NestJS will fetch Keycloak's **public** signing key and verify with
asymmetric RS256, so the API can confirm a token's authenticity without ever
holding a secret that could mint a fake one.

---

## The Decision

**Decision 1 — Authorization Code Flow with PKCE, not Implicit or Password flow.**

Chose: Authorization Code Flow with PKCE (Proof Key for Code Exchange).

Because: Next.js redirects the user to Keycloak's hosted login page; Keycloak
redirects back with a short-lived **code**, not a token, in the URL. The
browser then exchanges that code for tokens in a second, direct
request — tokens never appear in browser history or server logs as a URL
fragment. PKCE adds a secret-to-itself check (a `code_verifier` /
`code_challenge` pair) so that even if the authorization code is intercepted
mid-redirect, an attacker can't redeem it without the original verifier,
which never left the browser. This matters because Next.js's frontend is a
**public client** — it ships to the browser, so it cannot hold a true client
secret.

> **Revised in Decision 3 below:** this assumed the browser itself would
> drive the redirect and code exchange. Once Next.js's *server* took over
> that job (via Auth.js), "ships to the browser" stopped being accurate for
> the client credential question — see Decision 3.

Alternative: Implicit Flow (tokens returned directly in the redirect URL).

Drawback of alternative: Deprecated in the OAuth2 security spec. Tokens end
up in browser history and `Referer` headers, and there is no PKCE-equivalent
protection against interception.

Alternative: Resource Owner Password Credentials (app collects username/password
directly, sends to Keycloak's token endpoint).

Drawback of alternative: Your own frontend handles raw passwords, defeating
the entire point of delegating credential management to Keycloak. Also
incompatible with adding Google OAuth later (Phase 2 of auth, per
`design.md`) since there's no password to collect for a third-party login.

**Decision 2 — NestJS validates via JWKS (asymmetric), not a shared secret.**

Chose: NestJS fetches Keycloak's public keys from its JWKS endpoint
(`/realms/<realm>/protocol/openid-connect/certs`) and verifies token
signatures with RS256.

Because: Keycloak signs tokens with a **private** key it never shares.
NestJS only ever needs the matching **public** key to verify a signature —
it can confirm a token is genuine without holding anything that could forge
one. This is strictly safer than the current placeholder, where
`JWT_SECRET` is symmetric: anyone who can read that one secret (an env var,
a leaked `.env`, a misconfigured CI log) could mint tokens that pass
`AuthGuard` for any user.

Alternative: Keep a shared secret, and have Keycloak sign with the same
`JWT_SECRET` configured as a static key.

Drawback of alternative: Keycloak doesn't support this directly (its built-in
realm keys are asymmetric RS256 by default), and even if forced, it
reintroduces the single-point-of-compromise problem above.

**Decision 3 — Auth.js (NextAuth) drives the flow, and `web` is a confidential
client, not a public one.**

Chose: Auth.js's built-in Keycloak provider (`next-auth/providers/keycloak`),
with the `web` client in `boardgame-realm.json` changed to
`publicClient: false` (confidential) and given a client secret.

Because: this session initially built the flow by hand with `oauth4webapi`
(PKCE generation, the `/auth` redirect, the `/token` exchange, all written
out explicitly) to make every moving part visible — see the worked example
and the endpoint table below, which still describe exactly what's happening
underneath. But Auth.js is the more production-shaped choice: it handles
session cookie encryption, refresh rotation, and CSRF/state validation, and
it's what most real Next.js + Keycloak deployments use, so the actual code
now uses it instead of the hand-rolled version.

This is also what revised Decision 1's "public client" framing. Decision 1
assumed the *browser* would drive the redirect and code exchange directly,
so it could never safely hold a secret. With Auth.js, the entire OAuth
dance — redirect, code exchange, refresh — runs inside Next.js's **server**
process (its Route Handlers); the browser only ever follows redirects. A
server process can hold a secret exactly like NestJS already does. Auth.js's
own Keycloak provider documentation recommends exactly this — a confidential
client — as the standard setup.

PKCE is not dropped by making the client confidential: Auth.js applies it by
default (`checks: ["pkce"]`) regardless of client type, and
`boardgame-realm.json` still requires it via
`attributes["pkce.code.challenge.method"]`. The confidential client adds a
second, independent factor (the secret) on top of PKCE — defense in depth,
not a replacement.

One consequence worth noting: the `web` client's secret is **not** written
into `boardgame-realm.json` — that file is committed to git, and a plaintext
secret in a committed file would violate the same principle
`secops.md`'s Vault checklist calls out for `.env` files and Compose configs.
Instead the `secret` field is omitted, so Keycloak generates a random one on
first import; it's copied manually from the admin console into the
git-ignored `.env` as `AUTH_KEYCLOAK_SECRET`. This manual copy step is a
placeholder — Phase 3's Vault topic will eventually automate injecting it.

Alternative: Keep `web` public (no secret), and override Auth.js's provider
config with `client: { token_endpoint_auth_method: "none" }`.

Drawback of alternative: technically supported, but goes against Auth.js's
own documented recommendation for Keycloak, trading a real (if minor)
security property — the extra secret factor — for no actual benefit, since
Next.js's server can hold a secret safely.

---

## OIDC Endpoints & Token Lifecycle

Two endpoints and three tokens come up constantly once login is wired up.
It's easy to blur them together, so here they are side by side.

**Endpoints** (both under `/realms/boardgame/protocol/openid-connect/`)

| Endpoint | Who calls it | When |
|---|---|---|
| `/auth` | Browser, via a full-page redirect | Once, to start a login. Returns an authorization `code` in the redirect back to Next.js. |
| `/token` | Next.js, as a direct server-to-server-style call (not a redirect) | Twice, for two different reasons — see below. |
| `/certs` | NestJS, via `createRemoteJWKSet` | Lazily, cached — this is the JWKS endpoint used to verify tokens, not to get one. |

`/token` is called with a different `grant_type` each time, and the two calls
are not interchangeable:

1. **`grant_type=authorization_code`** — the *first* call, right after login.
   Sends the authorization `code` from `/auth` plus the PKCE `code_verifier`.
   The code and verifier are both single-use; Keycloak invalidates the code
   the instant this call succeeds, so this exact request can never be
   repeated.
2. **`grant_type=refresh_token`** — every *subsequent* call, whenever the
   access token expires. Sends the `refresh_token` from the original
   response instead. No code, no verifier, no redirect — this is what makes
   silent token renewal possible without bouncing the user back through
   `/auth`.

**Tokens returned by that first `/token` call**

| Token | Lifespan (typical Keycloak default) | Used for |
|---|---|---|
| `access_token` | Short — 5 minutes | Sent as `Authorization: Bearer <token>` on every NestJS API request. This is the one `AuthGuard` verifies. |
| `refresh_token` | Longer — governed by the realm's "SSO session idle" setting | Redeemed at `/token` (grant_type=refresh_token) to get a new `access_token` without re-authenticating. Once *this* expires, the user must go through `/auth` again. |
| `id_token` | Same order as `access_token` | An OIDC-specific token describing *who* logged in (name, email). Read by the frontend to render "logged in as ___"; never sent to NestJS as an API credential. |

The through-line: `/auth` + PKCE only ever happens once per login session.
Everything that keeps the session alive afterward — access token expiry,
silent renewal — runs entirely through `/token` and the `refresh_token`,
without touching `/auth` or generating a new PKCE pair.

---

## Worked Example

This is **not** the board game platform's Keycloak setup. It's a minimal
standalone simulation of the same flow using a fake "auth server" so you can
see token issuance and JWKS verification without Keycloak's admin UI in the
way.

### Scenario

A tiny Express API (`resource-server.js`) protects `GET /me`. A second
script (`token-issuer.js`) plays the role of Keycloak: it has an RSA keypair,
signs a JWT with the private key, and exposes the public key the way a JWKS
endpoint would. The resource server never sees the private key — only the
public one, fetched over HTTP, exactly like NestJS will fetch Keycloak's.

### Code / Configuration

`token-issuer.js` — stands in for Keycloak's token + JWKS endpoints:
```js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');

// In real Keycloak this keypair is generated once per realm and the private
// half never leaves the server. We generate it here just to have something
// to sign with.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const app = express();

// Stand-in for Keycloak's token endpoint:
// POST /realms/<realm>/protocol/openid-connect/token
app.get('/issue-token', (req, res) => {
  // sub = "subject" = the user's stable ID. Everything downstream (NestJS,
  // your `users` table) keys off this, never off email (emails can change).
  const token = jwt.sign(
    { sub: 'user-123', email: 'alice@example.com' },
    privateKey,
    { algorithm: 'RS256', expiresIn: '5m' }, // RS256, not HS256 — asymmetric
  );
  res.json({ access_token: token });
});

// Stand-in for Keycloak's JWKS endpoint:
// GET /realms/<realm>/protocol/openid-connect/certs
// Real Keycloak returns this in JWK format (a JSON-encoded key); we return
// PEM directly here to keep the resource server's verify step simple.
app.get('/public-key', (req, res) => {
  res.type('text/plain').send(publicKey.export({ type: 'spki', format: 'pem' }));
});

app.listen(4000, () => console.log('token-issuer on :4000'));
```

`resource-server.js` — stands in for the NestJS API:
```js
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();

// In real life this is cached with a TTL, not fetched on every request —
// NestJS will do the same via a JWKS client library. Fetched once here for
// clarity.
let cachedPublicKey = null;
async function getPublicKey() {
  if (!cachedPublicKey) {
    const res = await fetch('http://localhost:4000/public-key');
    cachedPublicKey = await res.text();
  }
  return cachedPublicKey;
}

app.get('/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const publicKey = await getPublicKey();
    // Note: only RS256 is accepted. Without pinning the algorithm, a token
    // signed with HS256 using the *public key string itself* as an HMAC
    // secret would also pass — a real vulnerability class called
    // "algorithm confusion."
    const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    res.json({ userId: payload.sub, email: payload.email });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

app.listen(3000, () => console.log('resource-server on :3000'));
```

Try it: `curl http://localhost:4000/issue-token` to get a token, then
`curl -H "Authorization: Bearer <token>" http://localhost:3000/me`.

### What Is Happening Step by Step

1. **`token-issuer.js` generates an RSA keypair at startup.** This mirrors
   what Keycloak does once per realm when you create it — it's not something
   you configure, it just exists.

2. **`/issue-token` signs a JWT with the *private* key.** The payload
   (`sub`, `email`) becomes the token's claims — the same shape as Keycloak's
   tokens, just with fewer fields. `RS256` means "RSA signature using
   SHA-256," an asymmetric algorithm.

3. **`/public-key` exposes only the public half.** This is the JWKS endpoint
   in miniature. Anyone can fetch this — it grants no power to forge tokens,
   only to verify them.

4. **`resource-server.js` fetches the public key once and caches it**,
   then calls `jwt.verify(token, publicKey, { algorithms: ['RS256'] })`.
   This call does three things at once: checks the signature is valid for
   that public key, checks `exp` (expiry) hasn't passed, and — critically —
   refuses to even attempt verification with any algorithm other than
   `RS256`.

5. **The resource server never talks to the issuer per-request.** Once it
   has the public key, every subsequent `/me` call is verified locally,
   in-process, with no network round trip. This is what makes JWTs fast
   compared to session-token-in-a-database schemes — and it's why a
   compromised resource server can't forge new tokens even though it can
   read old ones.

### What Would Break If You Changed X?

If you removed `{ algorithms: ['RS256'] }` from `jwt.verify`, the call would
accept *any* algorithm the token claims to use — including `HS256` (HMAC).
An attacker could craft a token with header `{"alg":"HS256"}`, sign it using
the *public key string* as the HMAC secret (which is, by definition, public),
and `jwt.verify` would treat that public key as a valid HMAC secret and
accept the forged token. This is a well-known real-world JWT library bug
class — pinning the expected algorithm is not optional.

---

## Now Apply It

The board game platform splits this exactly the way the example does, but
with real Keycloak in the middle instead of `token-issuer.js`:

- Keycloak itself runs as a service in `docker-compose.dev.yml`, with a
  realm `boardgame` and a confidential client `web` configured for
  Authorization Code + PKCE (see Decision 3 for why confidential, not
  public), redirecting back to Next.js.
- `apps/web/auth.ts` configures Auth.js with the built-in Keycloak provider.
  It reads `clientId`/`clientSecret`/`issuer` from env vars automatically
  (`AUTH_KEYCLOAK_ID`/`AUTH_KEYCLOAK_SECRET`/`AUTH_KEYCLOAK_ISSUER`) — nothing
  secret is hardcoded in the file itself.
  `apps/web/app/api/auth/[...nextauth]/route.ts` exposes Auth.js's handlers
  (login redirect, callback, session, sign-out) under one catch-all route.
- `apps/api/src/auth/auth.guard.ts` was rewritten: instead of
  `jwt.verify(token, process.env.JWT_SECRET!)`, it fetches Keycloak's JWKS
  endpoint (cached, via `jose`'s `createRemoteJWKSet`), verifies with `RS256`
  pinned exactly like the example, and pulls `req.user` from the resulting
  payload — the `extractToken` method and its transport-agnostic shape stay
  untouched, because that part of the design didn't depend on *how* tokens
  are signed.

Files to look at after this note:
- `apps/api/src/auth/auth.guard.ts` — the JWKS-based `jwtVerify` call that
  replaced the old shared-secret `jwt.verify`.
- `apps/web/auth.ts` and `apps/web/app/api/auth/[...nextauth]/route.ts` — the
  whole login flow in about a dozen lines, because Auth.js absorbs the
  redirect/PKCE/exchange mechanics described in the worked example above.
- `docker-compose.dev.yml` — the `keycloak` service, env vars following the
  same pattern as `db`.
- `infra/keycloak/boardgame-realm.json` — the `web` client's
  `publicClient: false` and the deliberately-omitted `secret` field (see
  Decision 3 and the SecOps notes below).
- `design.md` lines 227–241 — the authentication responsibilities split
  this note is built from.

### `infra/keycloak/boardgame-realm.json` — Field Reference

JSON has no comment syntax, and Keycloak parses this file literally on
import, so the annotations live here instead.

**Realm level**

| Field | What it does |
|---|---|
| `realm` | The realm's ID. Appears in every URL Keycloak generates for it: `/realms/boardgame/...`. |
| `enabled` | Master on/off switch — a disabled realm rejects all logins, even with correct credentials. |
| `sslRequired` | `"external"` in dev (see the checkpoint discussion above) — would be `"all"` in production. |
| `registrationAllowed` | Whether users can self-register from the login page, vs. only being created by an admin/invite. |

**Client `web`**

| Field | What it does |
|---|---|
| `clientId` | The `client_id` sent on every auth request — identifies *which* registered application is asking. |
| `protocol` | `"openid-connect"` — Keycloak also supports `"saml"` for older enterprise SSO; irrelevant here. |
| `publicClient` | `false` — `web` is confidential (see Decision 3): Next.js's *server* drives the OAuth flow via Auth.js, so it can hold a secret the way NestJS already does. There's deliberately no `"secret"` field alongside it — Keycloak generates one randomly on first import instead of a plaintext secret being committed to git; it's copied into `.env` manually afterward. |
| `standardFlowEnabled` | Enables the Authorization Code flow — the one we chose. |
| `directAccessGrantsEnabled` | `false` — disables the Resource Owner Password Credentials flow, the alternative explicitly rejected in Decision 1. |
| `implicitFlowEnabled` | `false` — disables the deprecated Implicit flow, the other rejected alternative. |
| `serviceAccountsEnabled` | `false` — this client can't authenticate as itself (machine-to-machine); it only ever acts on behalf of a logged-in user. |
| `redirectUris` | Whitelist of URLs Keycloak is allowed to send the authorization code back to. Without this allowlist, an attacker could register a malicious redirect and steal codes meant for the real app — a variant of open-redirect abuse. |
| `webOrigins` | CORS allowlist for browser-side calls to Keycloak's endpoints (e.g. the token endpoint during code exchange). |
| `attributes["pkce.code.challenge.method"]` | `"S256"` — requires the SHA-256 PKCE challenge method specifically; the OAuth2 spec also allows a weaker `"plain"` method (challenge = verifier, unhashed) that provides no real protection. |

**`components["org.keycloak.keys.KeyProvider"]`** — the realm's signing key

| Field | What it does |
|---|---|
| `providerId: "rsa-generated"` | Tells Keycloak to generate and manage its own RSA keypair internally (vs. importing an externally-generated one via `"rsa"` provider). |
| `config.priority` | When multiple key providers exist (e.g. during a rotation), the enabled one with the *highest* priority is the Active signer. |
| `config.active` | Whether this provider's key is used to sign *new* tokens right now. |
| `config.enabled` | Whether this provider's public key is still published in JWKS at all. This is what separates Passive (`active: false`, `enabled: true` — old key, still verifiable) from Disabled (`enabled: false` — fully retired, matches the Keys tab's three states from the checkpoint discussion above). |
| `config.algorithm` | `"RS256"` — must match what `AuthGuard` pins in its `jwtVerify` call, or tokens signed here would be rejected as an unexpected algorithm. |
| `config.keySize` | `2048` — the RSA modulus length in bits; Keycloak's default and still considered secure. |

To actually rotate later, you'd add a **second** `KeyProvider` entry with a
higher `priority` and `active: true`, and flip this one to `active: false`
(still `enabled: true` for the grace window) — declaring the rotation in
this file the same way you'd declare it by clicking through the Keys tab.

---

## SecOps Notes

**Security property upheld:** Credential isolation and signature
non-forgeability. The application (NestJS, Next.js) never sees or stores
user passwords — only Keycloak does, behind its own hardened, well-audited
login flow. Separately, asymmetric signing means even a fully compromised
NestJS container (env vars and all) cannot mint valid tokens for other
users, because it never holds Keycloak's private key.

**What attack this mitigates:** If `AuthGuard` kept using a shared
`JWT_SECRET`, leaking that one env var (a misconfigured log, a committed
`.env`, a compromised container) would let an attacker forge a valid token
for *any* user ID instantly. With JWKS-based RS256 verification, the same
leak gives an attacker nothing — there's no private key to find on the
NestJS side at all.

**What would go wrong if skipped:** Sticking with the current placeholder
shared-secret scheme into Phase 4 (cloud deployment) would mean the single
most sensitive secret in the system sits in a `.env` file or container env
var, with no rotation story and a blast radius of "every user account" if it
leaks.

**Checklist from `secops.md` relevant here:**
- [x] Default Keycloak admin credentials are not used in any committed
      config — `KEYCLOAK_ADMIN_USER`/`PASSWORD` are read from `.env`
      (git-ignored), not hardcoded in `docker-compose.dev.yml`
- [x] `AuthGuard`'s `extractToken` stays transport-agnostic (it already was —
      see the "Transport-Agnostic Auth Guard" pattern in `secops.md`) so the
      same JWKS verification logic works for WebSockets in Phase 3 later
- [x] JWKS key fetch is cached, not fetched per-request — `jose`'s
      `createRemoteJWKSet` handles this internally
- [x] The `web` client's secret is never committed to git — omitted from
      `boardgame-realm.json` so Keycloak generates it randomly, copied
      manually into the git-ignored `.env` as `AUTH_KEYCLOAK_SECRET`
      (see Decision 3)

---

## Checkpoint Questions

1. Why can Keycloak's JWKS endpoint be public — what would an attacker
   actually gain by fetching it, and what *couldn't* they do with it?
2. Walk through what happens, step by step, if a user's access token expires
   while they're using the app — where does that get detected, and what
   should happen next?
3. Why does pinning `algorithms: ['RS256']` in the verify call matter? What's
   the actual attack if it's left unpinned?
4. How does the realm/client split map onto "tenant" vs "application" — if
   we added a second product on the same Keycloak instance later, what would
   need a new realm vs just a new client?
5. `AuthGuard`'s `extractToken` method doesn't change in this rewrite, only
   the verification logic inside `canActivate` does. Why was the code
   originally split that way back in Phase 2?

---

## Rewrite Exercise

Delete the Keycloak service block from `docker-compose.dev.yml`, the
rewritten verification logic in `apps/api/src/auth/auth.guard.ts`, and
`apps/web/auth.ts` + `apps/web/app/api/auth/[...nextauth]/route.ts`, then
recreate them from memory using this note as your only reference.

Focus on: getting the JWKS fetch-and-cache step right and correctly pinning
`algorithms: ['RS256']` in the guard — these are the two details most likely
to be silently dropped, and both are the actual security-relevant lines in
the whole guard. On the Next.js side, focus on *why* `web` is confidential
now instead of public (Decision 3), not on reproducing Auth.js's API from
memory — the point is understanding the architecture, not the library's
exact function signatures.

---

## Summary

Built the JWT verification rewrite end-to-end: `AuthGuard` now fetches
Keycloak's JWKS and verifies with RS256 instead of a shared `JWT_SECRET`,
Auth.js drives the Authorization Code + PKCE flow as a confidential client
from Next.js's server, and the realm/client config lives in
`boardgame-realm.json` under `--import-realm`. At checkpoint, correctly
explained why a compromised NestJS container gains nothing under JWKS/RS256
(it never holds the private signing key) versus full forgery power under the
old symmetric secret, and correctly separated PKCE (protects the code
exchange, Decision 1) from JWKS/RS256 (protects what NestJS holds to verify,
Decision 2) after a nudge. In the extension exercise, independently spotted
that `canActivate`'s `context.switchToHttp().getRequest()` call for
attaching `request.user` is *also* HTTP-specific — not just `extractToken`
as the note implied — a real gap that `3_websockets` will need to close.
Didn't yet know Socket.io's handshake mechanics (reading the token from
`handshake.auth.token`, not a header or URL), which is expected since that's
`3_websockets` material, not yet covered — flagged as a head start for that
topic rather than a gap in this one.
