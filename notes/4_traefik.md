# Traefik — Reverse Proxy, Let's Encrypt TLS, Rate Limiting, WSS, Security Headers

**Phase:** 4 — Cloud Infrastructure & Hardening
**Topic ID:** `4_traefik`
**Date:** 2026-07-16
**SecOps:** Yes

---

## What Is This?

A reverse proxy sits in front of your application containers and is the only
thing the internet can reach directly. Instead of exposing `api` on port 3000
and `web` on port 3000 (a conflict) directly to the world, every request
hits the proxy first, and the proxy decides — based on the hostname or path
in the request — which internal container should actually handle it. Traefik
is a reverse proxy built specifically for container environments: instead of
a static config file you hand-edit every time you add a service, it watches
the Docker API directly and reconfigures itself automatically when a
container with the right labels starts or stops.

---

## Why Does It Matter for This Project?

Right now `api` and `web` in `docker-compose.yml` use `expose: "3000"` —
reachable from other containers on the Docker network, but not from the
host or the internet at all (see the comment at `docker-compose.yml:56-60`:
*"Traefik (a later topic) will route to it by service name"*). Traefik is
the thing that closes that gap: it terminates TLS, gets a free Let's
Encrypt certificate automatically, and routes `boardgame.example.com/api/*`
to the `api` container and everything else to `web` — all from Docker
labels on those two services, no separate config file to keep in sync.

---

## The Decision

Chose: Traefik, configured via Docker labels on each service, with automatic
Let's Encrypt certificate issuance.

Because: Traefik's Docker provider means the *service itself* declares how
it wants to be routed (via labels in `docker-compose.yml`), so adding a new
service later never requires touching a central proxy config file — Traefik
notices the new container and its labels via the Docker socket. It also has
first-class WebSocket support (needed for `3_websockets` group chat) and a
built-in ACME client, so TLS certificates renew themselves with no cron job.

Alternative: Nginx with a hand-written `nginx.conf` and `certbot` running
as a separate container/cron job for certificate renewal.

Drawback of alternative: Every new service (or every DNS/routing change)
means editing a static config file and reloading Nginx — a manual step
that's easy to forget, and drifts from what's actually running. Certbot
renewal is a second moving part (a cron job or sidecar) that can silently
fail if nobody's watching it, whereas Traefik's ACME handling is part of
the same process that's already required to be up for routing to work at
all.

---

## Worked Example

This is a standalone two-service example — NOT the board game platform's
actual compose file — so you can see the Traefik pattern in isolation.

### Scenario

You have two tiny services: a `whoami` container (just echoes request info)
and Traefik itself. You want `whoami.localhost` to be routed to `whoami`,
with HTTP requests automatically redirected to HTTPS, plus a rate limit and
a couple of security headers applied.

### Code / Configuration

`docker-compose.yml`:
```yaml
services:
  traefik:
    image: traefik:v3.1
    command:
      # Enables the Docker provider: Traefik watches container labels
      # instead of reading routing rules from a static file.
      - --providers.docker=true
      # Don't route to every container by default — only ones explicitly
      # labeled 'traefik.enable=true'. Without this, EVERY container on
      # the network (including traefik itself) becomes a routing target.
      - --providers.docker.exposedbydefault=false
      # Define the two entrypoints (listening ports) Traefik itself binds.
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      # ACME (Let's Encrypt) config: HTTP-01 challenge answered on the
      # 'web' entrypoint, cert stored in acme.json.
      - --certificatesresolvers.le.acme.httpchallenge=true
      - --certificatesresolvers.le.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.le.acme.email=admin@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      # Traefik needs to read container labels/events — this is a
      # read-only mount of the Docker socket, not a bind of app code.
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt

  whoami:
    image: traefik/whoami
    # No 'ports:' at all — whoami is unreachable from the host directly.
    # Traefik reaches it over the Docker network by container name/port,
    # the same way 'api'/'web' already work with each other today.
    labels:
      # Opt this specific container into routing (see exposedbydefault above).
      - traefik.enable=true
      # The routing rule: which incoming Host header goes to this service.
      - traefik.http.routers.whoami.rule=Host(`whoami.localhost`)
      - traefik.http.routers.whoami.entrypoints=websecure
      - traefik.http.routers.whoami.tls.certresolver=le
      # A second router: catch plain HTTP on the same host and redirect it.
      - traefik.http.routers.whoami-insecure.rule=Host(`whoami.localhost`)
      - traefik.http.routers.whoami-insecure.entrypoints=web
      - traefik.http.routers.whoami-insecure.middlewares=redirect-https
      # Middlewares: reusable request/response transforms, attached to a
      # router by name. Defined once, referenced by any router.
      - traefik.http.middlewares.redirect-https.redirectscheme.scheme=https
      - traefik.http.middlewares.ratelimit.ratelimit.average=10
      - traefik.http.middlewares.ratelimit.ratelimit.burst=20
      - traefik.http.middlewares.secheaders.headers.stsSeconds=31536000
      - traefik.http.middlewares.secheaders.headers.frameDeny=true
      - traefik.http.middlewares.secheaders.headers.contentTypeNosniff=true
      # Attach both middlewares to the secure router, comma-separated.
      - traefik.http.routers.whoami.middlewares=ratelimit,secheaders

volumes:
  letsencrypt:
```

### What Is Happening Step by Step

1. **Traefik starts and binds two ports** — 80 and 443 — and immediately
   starts watching the Docker socket for containers with
   `traefik.enable=true`.

2. **`whoami` starts with labels, not open ports.** It never binds 80/443
   itself; Traefik proxies to it over the internal Docker network using the
   container's actual listening port (`whoami` defaults to 80 — Traefik
   auto-detects it, or you'd add `traefik.http.services.whoami.loadbalancer.server.port`
   if it needed to be explicit).

3. **Two routers exist for one service** — `whoami` (HTTPS, port 443) and
   `whoami-insecure` (HTTP, port 80). Both match the same `Host` rule, but
   the insecure one's only job is to apply the `redirect-https` middleware
   and bounce the request to the secure router.

4. **The ACME resolver (`le`) does the certificate dance the first time
   `whoami.localhost` is requested over HTTPS** — Let's Encrypt asks Traefik
   to prove it controls the domain by serving a specific file over plain
   HTTP (the "HTTP-01 challenge"), Traefik answers that automatically on
   the `web` entrypoint, and the resulting certificate is cached in
   `acme.json` inside the `letsencrypt` volume so this only happens once
   per domain, not on every restart.

5. **Middlewares run in the order attached**, before the request reaches
   `whoami`. `ratelimit` rejects requests once the token bucket (10/sec
   average, 20 burst) is exhausted; `secheaders` adds response headers
   *after* whoami replies, without whoami's own code knowing anything
   about HSTS or clickjacking protection.

### What Would Break If You Changed X?

If you removed `--providers.docker.exposedbydefault=false` (or set it to
`true`), every container on the Docker network — including ones with no
`traefik.*` labels at all, and Traefik's own dashboard if enabled — would
become an open routing target reachable from the internet the moment it
joined the network. This is a real security-relevant default, not just a
convenience knob.

---

## Now Apply It

The board game platform's `api` and `web` services already have the shape
Traefik expects: no host `ports:` mapping, just `expose: "3000"` and a
service name Traefik can route to by name (`docker-compose.yml:29-76`).
Adding Traefik means:

- A new `traefik` service (likely `infra/traefik/` for any static config,
  following the same convention as `infra/vault/` and `infra/keycloak/`).
- Labels added to `api` and `web` in `docker-compose.yml`, routing by path
  (`/api/*` → `api`) or subdomain, plus the `redirect-https` middleware on
  both.
- The `keycloak` service's port mapping (`8080:8080` in
  `docker-compose.dev.yml:54-55`) stops being needed in production —
  Traefik routes to it by container name too, on whatever hostname you pick
  (e.g. `auth.example.com`).
- Rate limiting and the four security headers from `references/secops.md`'s
  Network Hardening section, applied as middlewares — this is what
  `4_fail2ban` (next-but-one topic) builds on, since Fail2ban needs
  Traefik's access logs to know which IPs to ban.

Files to look at after this note:
- `docker-compose.yml` — the `api`/`web` service blocks, to see exactly what
  labels will be added and what `expose` already gives you for free.
- `infra/vault/`, `infra/keycloak/` — the existing pattern for where a new
  service's static config files live.

---

## SecOps Notes

This topic is the "Network Hardening" layer 2 from `references/secops.md`
(Traefik middleware), sitting between Oracle Cloud NSGs (layer 1, already
built in `4_terraform`) and Fail2ban (layer 3, not yet built).

**Security property upheld:** defence in depth at the HTTP layer — even if
an NSG rule is accidentally too permissive, Traefik's own middlewares still
rate-limit and header-harden every request that reaches it.

**What it mitigates:**
- No TLS at all, or TLS terminated somewhere inconsistent → Traefik makes
  HTTPS the only reachable path (HTTP always redirects), so credentials and
  JWTs from Keycloak are never sent in plaintext over the network.
- No rate limiting → a brute-force script against Keycloak's login endpoint
  or the NestJS API can run unthrottled. `4_fail2ban` bans by IP after
  repeated failures, but that requires failures to *happen slowly enough to
  count* — rate limiting is what keeps a single request burst from
  overwhelming the API before Fail2ban would ever trigger.
- Missing security headers → `Content-Security-Policy`, `X-Frame-Options`,
  `X-Content-Type-Options`, and HSTS are the kind of protection that costs
  nothing to add but is easy to forget entirely if it isn't centralized —
  putting them in Traefik middleware means every service gets them for free,
  rather than each app needing its own header-setting code (and each one
  being a place to forget).

**What would go wrong if skipped:** exactly what today's setup already has
— `api`/`web` are simply unreachable from outside (safe by omission, not by
design), which isn't a real deployment. The moment you *do* expose them
without Traefik (e.g. adding `ports: "3000:3000"` directly to `api` as a
quick fix), you'd have no TLS, no rate limiting, and no security headers at
all — worse than the current "not reachable yet" state.

---

## Checkpoint Questions

1. Why does `whoami` (or `api`/`web`) never map a host port itself, and how
   does Traefik reach it anyway?
2. If `whoami.localhost` served plain HTTP with no certificate error, what's
   the most likely misconfigured label, and why?
3. What is `--providers.docker.exposedbydefault=false` actually protecting
   against, concretely?
4. How does the ACME HTTP-01 challenge work, and why does it require the
   `web` entrypoint (port 80) even for a service that's otherwise
   HTTPS-only?
5. Why does rate limiting live in Traefik rather than in NestJS application
   code, given that NestJS could also implement a rate limit guard?

---

## Summary

Built: a `traefik` service in `docker-compose.yml` (Docker provider,
`web`/`websecure` entrypoints, static HTTP→HTTPS redirect, Let's Encrypt via
the `le` resolver, a `letsencrypt` named volume) plus router/middleware
labels on `traefik` (shared `ratelimit` and `secheaders` middlewares,
`api-stripprefix`), `api` (`Host()+PathPrefix(/api)` router, `chat` router
for the socket.io path), and `web` (catch-all `Host()` router) — replicating
`next.config.ts`'s `/api/:path*` rewrite contract at the proxy layer
instead of in Next.js, and extending it to WSS for `3_websockets`'s chat
gateway.

Demonstrated understanding of: the static-vs-dynamic config split
(entrypoint redirect vs. middleware/router labels) and why it can't be
forgotten per-service; that TLS termination happens entirely inside
Traefik regardless of which container's labels a router is declared
under; automatic router priority by rule specificity (no manual priority
needed between `api`'s `PathPrefix` and `web`'s catch-all); and that
Traefik detects and proxies WebSocket upgrades natively, with no special
config beyond normal routing (unlike Nginx).

To revisit: none — all checkpoint questions were answered correctly,
including reasoning through the entrypoint-redirect edge case in Q3
without being given the answer directly.
