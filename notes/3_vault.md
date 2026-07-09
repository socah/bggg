# HashiCorp Vault — Secrets Management & Vault Agent Injection

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** `3_vault`
**Date:** 2026-07-08
**SecOps:** Yes

---

## What Is This?

HashiCorp Vault is a service that stores secrets (passwords, API keys,
tokens) centrally and hands them out on request to anyone who can prove they
are authorized — instead of every service having its own copy of a password
sitting in a config file. **Vault Agent** is a small companion process that
runs next to your application, logs into Vault on the app's behalf, and
writes the secrets it fetches into a plain file on disk (or keeps them only
in memory) — so the application itself never needs to know how to talk to
Vault at all. It just reads a file that happens to already have the right
value in it by the time the app starts.

---

## Why Does It Matter for This Project?

Right now `DB_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, and the R2 keys all live
in plaintext in `.env` on disk, and Compose injects them as literal
environment variables — visible to anyone who runs `docker inspect db` or
`docker exec db env`. `3_keycloak.md` already flagged this exact gap (the
`AUTH_KEYCLOAK_SECRET` copy-paste step) and said Vault would eventually
automate it. This topic makes good on that: one secret (the Postgres
password) moves out of `.env` and into Vault, injected into the `db`
container by Vault Agent at startup instead.

---

## The Decision

Chose: Vault running in **dev mode** as a Docker Compose service, plus a
Vault Agent sidecar that authenticates with a token and renders one secret
(the Postgres password) to a file, which the official `postgres` image reads
via `POSTGRES_PASSWORD_FILE`.

Because: this mirrors design.md's stated architecture exactly — "Vault
Agent injects secrets into containers at runtime — secrets never touch disk
or appear in environment variable listings" — while staying achievable on a
personal machine. Dev mode auto-unseals and needs zero Shamir-key ceremony,
and the `_FILE` convention means **zero application code changes** are
needed to consume the injected secret — the official Postgres image already
knows to read `POSTGRES_PASSWORD_FILE` instead of `POSTGRES_PASSWORD` if
it's set. Getting this one secret right end-to-end is the whole pattern;
Keycloak's admin password and the R2 keys are the same recipe repeated.

Alternative 1: Use Vault's **AppRole** auth method (role ID + secret ID)
even in dev, since that's what a real production deployment would use.
Drawback: AppRole requires a second bootstrap step to generate and securely
deliver the secret ID to the agent before it can even authenticate — real
ceremony that protects against a threat model (a compromised host stealing
long-lived credentials) that doesn't really exist on a single developer's
laptop. It's the right call for Phase 4 production, documented below as a
deliberate gap.

Alternative 2: Skip Vault entirely in dev, and only introduce it in Phase 4
when deploying to the Oracle VM. Drawback: the dev and prod environments
would diverge on exactly the piece most likely to be gotten wrong under
deploy pressure — secrets wiring. Exercising the pattern now, while it's low
stakes, is safer than debugging Vault Agent for the first time during a
production rollout.

---

## Key Concepts

**Static vs. dynamic secrets.** A *static* secret is a fixed value you put
into Vault yourself (e.g. today's Postgres password) — Vault just stores and
guards it. A *dynamic* secret is one Vault **generates on demand**, with its
own expiry: ask Vault for "a Postgres credential" and it creates a brand-new
database user with a random password and a lease (e.g. "valid for 1 hour"),
then automatically revokes it when the lease expires. This project starts
with a static secret (simpler, matches how `postgres:16-alpine` is
already configured), but because it's already in Vault's KV store, switching
that one secret to Vault's dynamic **database secrets engine** later doesn't
require touching Vault Agent's config at all — only what Vault hands back
changes.

**Unsealing.** Vault encrypts everything it stores with a master key that is
*not* stored anywhere on disk in one piece — normally it's split into
several key shares (Shamir's Secret Sharing), and a quorum of them must be
supplied by hand every time Vault (re)starts, before it will serve any
secret ("unsealing"). `vault server -dev` skips all of this: it generates
an in-memory master key and unseals itself automatically on boot. That's
exactly why dev mode is disqualified for production (the note it stores
disappears on every restart, and there's no unseal ceremony to protect
against a stolen disk) — but for local development, where the whole
container is disposable anyway, it's the documented, acceptable choice.

**KV v2 secrets engine.** Vault's basic building block for static secrets —
a versioned key-value store mounted at a path (e.g. `secret/`). "Versioned"
means overwriting a secret doesn't destroy the old value; you can read
`secret/data/bggg/db?version=1` to see what the password used to be, useful
for audit and rollback.

**Vault Agent auto-auth + templates.** Vault Agent has two jobs, configured
in one HCL file: `auto_auth` (log into Vault using some method — a raw
token for dev, AppRole/Kubernetes/AWS IAM in production — and keep the
resulting Vault token renewed), and `template` (given a Vault path and a Go
template, render the result to a file, and re-render whenever the
underlying secret changes). The application never sees Vault credentials at
all — only the rendered file.

---

## Worked Example

This is **not** the board game platform's Vault setup — it's a minimal,
standalone walkthrough of the same mechanism (write a secret, have Agent
render it to a file) using a throwaway `api_key` value, run directly on the
command line with no Docker or Postgres involved.

### Scenario

You have a fake app that needs an `api_key`. Instead of hardcoding it, you
store it in Vault and use Vault Agent to materialize it into a file the app
reads at startup.

### Code / Configuration

```bash
# 1. Start Vault in dev mode. It prints a root token — copy it, you'll need
#    it below. Dev mode is single-process, in-memory, auto-unsealed.
vault server -dev -dev-root-token-id="root-token-for-local-testing-only"

# --- in a second terminal ---

# 2. Point the CLI at the dev server and authenticate.
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='root-token-for-local-testing-only'

# 3. Write a static secret into the KV v2 engine (mounted at 'secret/' by
#    default in dev mode). This is the thing we want Agent to fetch for us.
vault kv put secret/myapp api_key="sk-example-12345"
```

```hcl
# agent.hcl — Vault Agent's own config file, NOT the app's config.

# auto_auth: how Agent itself logs into Vault. "token_file" is the simplest
# method that exists — Agent just reads a token from a file on disk. Real
# deployments use "approle" or a cloud-native method instead; token_file is
# a dev-only stand-in so the example doesn't need a second bootstrap step.
auto_auth {
  method "token_file" {
    config = {
      token_file_path = "/tmp/vault-token"
    }
  }
}

# template: what to render, and where. 'contents' is inline here for
# clarity, though a real setup usually points at a separate .tpl file. The
# {{ }} syntax is Vault's Go-template dialect: "go read this KV path, and
# pull out the field named api_key."
template {
  contents = <<EOT
{{- with secret "secret/data/myapp" -}}
{{ .Data.data.api_key }}
{{- end -}}
EOT
  destination = "/tmp/rendered/api_key.txt"
}
```

```bash
# 4. Give Agent a token to read (simulating what a real auto_auth method
#    would deliver automatically) and start it.
echo -n "root-token-for-local-testing-only" > /tmp/vault-token
vault agent -config=agent.hcl &

# 5. Confirm the file now exists with the secret's value inside it — no
#    application code ran, and no human copy-pasted the value anywhere.
cat /tmp/rendered/api_key.txt
# => sk-example-12345

# 6. Prove it's live, not a one-shot copy: update the secret in Vault...
vault kv put secret/myapp api_key="sk-rotated-67890"
sleep 2
# ...and the file updates itself, because Agent keeps watching the path.
cat /tmp/rendered/api_key.txt
# => sk-rotated-67890
```

### What Is Happening Step by Step

1. `vault server -dev` starts a single-node Vault, auto-unsealed, with a
   known root token — nothing is persisted once the process exits.
2. The KV v2 engine is enabled by default at `secret/` in dev mode; step 3
   writes one secret (`api_key`) under the path `secret/myapp`.
3. `agent.hcl`'s `auto_auth` block tells Agent *how to prove its identity*
   to Vault. `token_file` is the least realistic method (a real deployment
   wouldn't want a long-lived token sitting in a file) but it isolates the
   concept: Agent needs *some* credential before it can fetch anything.
4. The `template` block tells Agent *what to fetch and where to put it*.
   The `{{ with secret "secret/data/myapp" }}` syntax calls Vault's API
   under the hood (note the `data/` inserted into the path — KV v2 always
   nests actual secret data one level under `data` compared to the CLI
   path you write to).
5. Once Agent starts, it authenticates using the token file, resolves the
   template against Vault's current value, and writes the result to
   `/tmp/rendered/api_key.txt`. It then keeps a long-lived watch on that
   Vault path.
6. Updating the secret in Vault (step 6) causes Agent to notice the change
   and re-render the file automatically — no restart, no redeploy. This is
   the mechanism that makes secret rotation possible without touching the
   application at all: the app just needs to re-read the file (or be
   restarted), it never talks to Vault directly.

### What Would Break If You Changed X?

If the `auto_auth` block were deleted entirely, Agent would have no way to
authenticate to Vault at all — it would fail immediately on startup with an
authentication error, and the `template` block would never execute, so
`/tmp/rendered/api_key.txt` would simply never be created. Anything
downstream expecting that file to exist (in the real setup: the `db`
container's `POSTGRES_PASSWORD_FILE`) would fail to start with a "file not
found" style error, not a wrong-password error — a useful distinction when
debugging which layer broke.

---

## Now Apply It

The actual project wiring follows this exact shape, for one secret
(`DB_PASSWORD`) as the first proof of the pattern:

- `docker-compose.yml` / `docker-compose.dev.yml` — a `vault` service
  (dev mode, matching the worked example) and a `vault-agent` service using
  the same image, sharing a volume with `db` so the rendered password file
  is visible to both containers.
- `infra/vault/agent.hcl` — the real Agent config: same `auto_auth` +
  `template` shape as the worked example, but rendering to
  `/vault/secrets/db_password` instead of an `api_key`.
- `infra/vault/bootstrap.sh` — a one-time script (run once against the dev
  Vault) that writes `secret/bggg/db` with the current `DB_PASSWORD` value
  and generates the token Agent reads.
- `docker-compose.dev.yml`'s `db` service — `POSTGRES_PASSWORD` removed,
  replaced with `POSTGRES_PASSWORD_FILE=/vault/secrets/db_password`
  (an existing feature of the official `postgres` image, part of Docker's
  general `_FILE` convention for secrets — no application code changes).
- `.env.example` — `DB_PASSWORD` annotated as no longer the source of
  truth once Vault is wired up, mirroring the note already left on
  `AUTH_KEYCLOAK_SECRET`.

Files to look at after this note (once generated):
- `docker-compose.dev.yml` — look for the `vault`, `vault-agent`, and
  updated `db` service blocks
- `infra/vault/agent.hcl` — compare its `template` block to the worked
  example above
- `infra/vault/bootstrap.sh` — look for the `vault kv put` and policy setup

---

## SecOps Notes

This directly implements the **Secrets Management (Vault)** checklist from
`references/secops.md`:

- **No plaintext secrets in docker-compose.yml or committed `.env` files** —
  after this change, `DB_PASSWORD` is only a value inside Vault's storage
  (in dev mode, in-memory; in production, an encrypted backend), never a
  Compose `environment:` entry.
- **Unsealing strategy documented** — dev mode auto-unseals with an
  in-memory key, which is explicitly *only* acceptable because this is a
  local, disposable environment. Phase 4's production Vault deployment will
  need a real unseal strategy (Shamir key shares, manual entry on restart)
  and must not run `-dev` mode.
- **Vault Agent renews leases and restarts on failure** — noted as a gap in
  this dev setup (the `token_file` auth method never expires in dev mode,
  so there's nothing to renew yet); this becomes relevant once Phase 4
  switches to AppRole, where the agent's own login token *does* expire and
  must be renewed automatically.

**What attack does this mitigate?** Without Vault, `DB_PASSWORD` sits in
`.env` on disk (readable by anyone with filesystem access) and appears
verbatim in `docker inspect db`'s output and in `docker-compose config`'s
resolved output — both trivially accessible to anyone who can run Docker
commands on the host, including a compromised container escaping to the
host, or a misconfigured CI job that dumps `docker inspect` into logs. After
this change, the password exists on disk only as a file Vault Agent wrote
with restrictive permissions, and only in the one container that needs it —
`docker inspect db` no longer shows it in cleartext in the environment list.

**What would go wrong if this step were skipped?** Credentials would
continue to live in `.env`, meaning: rotating the DB password requires
editing a file and recreating containers by hand (no automation), and if
`.env` were ever accidentally committed (a `git add -A` slip is the classic
way this happens), the password would be permanently in git history even
after being removed from the working copy.

---

## Checkpoint Questions

1. What's the difference between a static secret and a dynamic secret, and
   which kind is `DB_PASSWORD` right now?
2. If someone ran `docker inspect db` on the running Postgres container
   after this change, would they see the plaintext password? Why or why
   not, compared to before?
3. If the `db` container failed to start with a "no password specified"
   style error right after this change, where would you look first, and
   why would that be a different failure than a wrong-password error?
4. What does Vault Agent's `auto_auth` block do, and why can't the
   `template` block do anything useful without it?
5. Why is running Vault in `-dev` mode acceptable for this project right
   now, but explicitly flagged as something that must change before
   Phase 4's production deployment?

---

## Summary

Built: `vault`, `vault-bootstrap`, and `vault-agent` services in
`docker-compose.yml`/`docker-compose.dev.yml`, plus
`infra/vault/bootstrap.sh`, `infra/vault/agent.hcl`, and
`infra/vault/agent-entrypoint.sh`. `db` now reads its password via
`POSTGRES_PASSWORD_FILE` from a file Vault Agent rendered, gated on a
healthcheck so `db` never starts before the file exists. Verified live end
to end with `docker compose up` and a manual `psql` connection using the
Vault-sourced password — not just read through.

Demonstrated understanding of: why KV v2 needs the extra `data/` path
segment (versioning metadata wrapper); why a "no password specified" error
is a plumbing failure (file missing) rather than a credentials failure
(wrong value), and where each would be debugged differently; why Vault dev
mode's in-memory storage and auto-unseal are both disqualifying for
production, independent of the fact that dev credentials are throwaway.

To revisit: production auth (AppRole, real unsealing, persistent storage
backend) is deliberately deferred to Phase 4 (`4_terraform`) — flagged in
this note's SecOps section as a known gap, not an oversight. Keycloak's
admin password and the R2 keys still live in plaintext `.env` values and
are natural next repeats of this exact pattern whenever picked up again.
