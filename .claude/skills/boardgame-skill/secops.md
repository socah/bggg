# SecOps Reference

When working on a topic tagged `secops: true`, read the relevant section
below and weave its content into the learning note and inline code comments.

---

## Secrets Management (Vault)

**What it teaches:** Secret lifecycle management — how secrets are stored,
rotated, and injected into running processes without ever appearing in
plaintext on disk or in environment variable listings.

**What goes wrong without it:** Credentials committed to git (even briefly)
are permanently exposed. `.env` files copied to servers create implicit
copies of secrets with no audit trail. Rotation requires redeployment.

**Key concept to explain:** The difference between *static* secrets (a fixed
password in a file) and *dynamic* secrets (a short-lived credential issued by
Vault on demand, automatically expired). Even if you start with static secrets
in Vault, the architecture supports rotation from day one.

**Checklist when implementing:**
- [ ] No plaintext secrets in docker-compose.yml, .env files committed to git,
      GitHub Actions environment variables (use GitHub Secrets instead), or
      Ansible playbooks
- [ ] Vault unsealing strategy documented (manual for a personal project is fine,
      but the user should understand what unsealing means and why it exists)
- [ ] Vault Agent configured to renew leases and restart on failure

---

## Container Security

**What it teaches:** The principle of least privilege applied to containers —
a compromised container should have the minimum access needed to do damage.

**What goes wrong without it:** A container running as root that achieves
container escape (a known class of vulnerability) has root access to the host.
A container with a writable filesystem can be used to persist malware.

**Checklist when implementing:**
- [ ] `USER` directive in Dockerfile sets a non-root user
- [ ] `read_only: true` in Docker Compose where applicable
- [ ] No `--privileged` flag
- [ ] Docker socket not mounted into application containers
- [ ] Images pinned to digest (`image: postgres@sha256:...`) in production,
      not floating tags

---

## Network Hardening

**What it teaches:** Defence in depth at the network layer — multiple
overlapping controls so that no single misconfiguration exposes the system.

**Layers to explain:**
1. Oracle Cloud NSGs (Terraform) — the outermost firewall, drops traffic
   before it reaches the VM
2. Traefik middleware — rate limiting and security headers at the HTTP layer
3. Fail2ban — bans IPs after repeated auth failures at the host level

**What goes wrong without it:** A misconfigured NestJS endpoint with no rate
limiting can be brute-forced. Keycloak exposed without Fail2ban will
accumulate failed login attempts indefinitely.

**Security headers to explain (each one, what it prevents):**
- `Strict-Transport-Security` — forces HTTPS even if user types http://
- `Content-Security-Policy` — prevents XSS by whitelisting script sources
- `X-Frame-Options: DENY` — prevents clickjacking via iframes
- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing attacks

**Checklist when implementing:**
- [ ] Rate limiting middleware applied to `/api/*` routes in Traefik
- [ ] All four security headers configured as Traefik middleware
- [ ] Fail2ban jail configured for Keycloak log path
- [ ] NSG rules reviewed — only 80, 443, and SSH port open inbound
- [ ] SSH config: `PasswordAuthentication no`, `PermitRootLogin no`

---

## OWASP Top 10 (API-relevant)

**What it teaches:** The most common classes of web vulnerability and how they
appear in a NestJS REST API specifically.

**Most relevant for this project:**

**Broken Access Control (A01)**
The most important one. Every endpoint that returns or modifies data must
check: does this user have permission to access *this specific resource*?
Not just "is the user logged in" but "does this user own this review / belong
to this group / have admin rights in this group?"

Example of the mistake:
```
GET /reviews/:id  →  return this.reviewsService.findById(id)
// Problem: any authenticated user can read any review by guessing IDs
```

Correct:
```
GET /reviews/:id  →  return this.reviewsService.findByIdForUser(id, req.user.id)
// Service checks review.user_id === req.user.id before returning
```

**Insecure Direct Object References (part of A01)**
Using sequential integer IDs (`/sessions/1`, `/sessions/2`) makes it trivial
to enumerate records. Use UUIDs for all public-facing IDs.

**Security Misconfiguration (A05)**
Keycloak shipped with default credentials. Swagger/OpenAPI endpoint exposed
in production. Debug logging enabled. CORS configured to `*`.

**Checklist when implementing:**
- [ ] Every endpoint has explicit ownership/membership check, not just auth check
- [ ] All primary keys are UUIDs (not sequential integers) in public-facing routes
- [ ] CORS configured to specific allowed origins, not wildcard
- [ ] Swagger disabled in production (NODE_ENV check)
- [ ] No default Keycloak admin credentials in production

---

## Audit Logging

**What it teaches:** How to create a queryable, tamper-evident record of
security-relevant events — the foundation of incident investigation.

**What goes wrong without it:** When something bad happens (a user's account
is compromised, an admin action is disputed, data is unexpectedly deleted),
you have no record of what occurred or who did it.

**Events that must be logged for this project:**
- `user.login` / `user.login_failed` — with IP address
- `group.invite_created` — who created it, for which group
- `group.member_kicked` — who kicked whom, from which group
- `group.role_changed` — who elevated whom, to what role
- `review.edited` — before/after snapshot in metadata (jsonb)
- `session.deleted` — who deleted it
- `admin.secret_rotated` — when a Vault secret is rotated

**Checklist when implementing:**
- [ ] audit_log table exists with `metadata jsonb` for flexible payload
- [ ] ip_address captured from request (behind Traefik — use X-Forwarded-For)
- [ ] Audit log writes are non-blocking (don't fail the main request on audit error)
- [ ] Loki receives the structured log stream (Phase 5)

---

## Dependency Scanning

**What it teaches:** The software supply chain — your dependencies have
dependencies, and any of them can introduce vulnerabilities.

**Tools:**
- `npm audit` — checks your lockfile against the npm advisory database.
  Run in CI, fail on `high` or `critical` severity.
- Dependabot — opens PRs automatically when a dependency has a known CVE.
  Set up in `.github/dependabot.yml` for both `npm` and `docker` ecosystems.
- Trivy — scans Docker images for OS-level and application-level CVEs.
  Run in CI after `docker build`, fail on `CRITICAL` severity.

**Checklist when implementing:**
- [ ] `.github/dependabot.yml` covers `npm` (backend + frontend) and `docker`
- [ ] `npm audit --audit-level=high` in CI pipeline, before build step
- [ ] Trivy scan in CI pipeline, after build step, before deploy step
- [ ] Base images are official minimal images (e.g. `node:20-alpine` not `node:latest`)

---

## Transport-Agnostic Auth Guard

**What it teaches:** Separation of concerns in authentication — the token
validation logic should not care whether it arrived via HTTP header or
WebSocket message.

**Why it matters here:** When group chat is added, WebSocket connections need
the same JWT validation as REST endpoints. If the guard is tightly coupled to
`req.headers.authorization`, it cannot be reused for WebSocket handshakes.

**Pattern to teach:**
```typescript
// Wrong — coupled to HTTP
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split(' ')[1];
    return this.validateToken(token);
  }
}

// Right — transport-agnostic
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const token = this.extractToken(context);
    return this.validateToken(token);
  }

  private extractToken(context: ExecutionContext): string | null {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest();
      return req.headers.authorization?.split(' ')[1] ?? null;
    }
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient();
      return client.handshake?.auth?.token ?? null;
    }
    return null;
  }
}
```

**Checklist when implementing:**
- [ ] `extractToken` method handles both `http` and `ws` context types
- [ ] WebSocket client sends token in `handshake.auth.token` (Socket.io standard)
- [ ] Same `validateToken` logic used for both transports — no duplication
