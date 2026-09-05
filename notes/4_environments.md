# Environment Strategy — Dev/Staging/Prod Compose Overlays, Config Promotion

**Phase:** 4 — Deployment & Infra
**Topic ID:** `4_environments`
**Date:** 2026-07-26
**SecOps:** Yes

---

## What Is This?

Docker Compose can read more than one YAML file for a single `docker compose`
invocation: `docker compose -f a.yml -f b.yml up`. Compose reads them in order
and merges them into one effective config — `b.yml` can add new services,
add new keys to a service `a.yml` already defined, or override a key `a.yml`
set. This is Compose's built-in mechanism for the general problem every
real deployment has: **most configuration is the same everywhere, a small
part must differ per environment** (secrets, exposed ports, debug flags,
replica counts), and you want the "same everywhere" part to exist in exactly
one file so it can't quietly drift out of sync between environments.

---

## Why Does It Matter for This Project?

This is exactly the bug that just surfaced. `docker-compose.yml` was meant
to be the file `ansible-playbook` runs standalone in production (see
`infra/ansible/roles/app_deploy/tasks/main.yml`'s `docker compose -f
docker-compose.yml up -d --build`). But `vault-agent`'s `volumes:`,
`entrypoint:`, and — critically — its `healthcheck:` only existed in
`docker-compose.dev.yml`, which production never loads. Production got a
`vault-agent` service with nothing but a bare image, no healthcheck to
satisfy `api`'s `depends_on: condition: service_healthy`, and Compose
refused to start it. `db` and `keycloak` have the identical problem one
step further down the chain — they'd fail next.

The bug didn't happen because anyone forgot to write the config. It
happened because there was no rule for *which file a given piece of config
belongs in* — "dev-specific" quietly grew to mean "everything," including
things (a healthcheck, a volume mount for a script) that have nothing to do
with dev vs. prod at all.

---

## Background: What Is IAM (and What's a "Dynamic Group")?

IAM (Identity and Access Management) is how a cloud provider answers two
questions before letting anything happen: *who (or what) is asking?* and
*what are they allowed to do?* Every resource this project's Terraform
touches passes through IAM somewhere — this note only spells it out now
because `infra/terraform/vault.tf` is the first place this project
*creates* IAM resources on purpose, rather than just relying on the
Terraform-authenticated user's own broad permissions.

**Principals** are the "who." A human user or a static API key is the
familiar case, but a running VM can *be* a principal too — an **instance
principal**. The cloud platform itself vouches for it, based on
cryptographic identity metadata the VM can prove it holds, with no
copyable secret changing hands. The analogy from the earlier OCI KMS vs.
Infisical discussion: a building's keycard reader recognizing a real badge
in real time, versus a photocopy of that badge that would work anywhere,
handed to anyone.

**Dynamic groups** are how "which instances count as this identity" gets
defined. An ordinary IAM group has humans added to it one at a time. A
*dynamic* group instead has a **matching rule** — `ALL {instance.id =
'...'}`, or more loosely `ALL {instance.compartment.id = '...'}` — that
OCI evaluates on every single request to decide, right then, who currently
belongs. `vault.tf`'s dynamic group matches one exact instance OCID, so
exactly one VM is ever a member, ever.

**Policies** are the "what," written in a plain-English-like grammar:
`Allow <who> to <verb> <resource-type> in <where> [where <condition>]`.
`vault.tf`'s policy reads almost like a sentence once you know the shape:

```
Allow dynamic-group bggg-vault-unseal-instance to use keys
  in compartment id <compartment ocid>
  where target.key.id = '<key ocid>'
```

"Let this one VM use [perform crypto operations with] keys in this
compartment — but only this one specific key, nothing else in the
compartment." Instance principal answers *who's asking*, the dynamic
group's matching rule decides *which VM(s) count as that identity*, and
the policy decides *what that identity may do* — as narrowly as the
`where` clause allows.

---

## Background: What Is Jinja2 (and What's a `.j2` File)?

Jinja2 is a text-templating language: a file that's mostly plain
text/config, with a few "fill this blank in" placeholders written as
`{{ variable_name }}`, plus light control-flow (`{% if %}`, `{% for %}`)
that still reads like text rather than code.

Ansible uses Jinja2 in two capacities that are easy to conflate:

1. **Inline expressions**, resolved right where they appear in a task —
   every `"{{ deploy_dir }}"` or `"{{ lookup(...) }}"` already seen
   throughout `tasks/main.yml` is this.
2. **Whole-file templates**, via the `template:` module: an entire file
   (conventionally named `something.j2` — the extension is a human
   signal, not something Ansible strictly requires) is read, every
   `{{ }}` inside it resolved against Ansible's current variables, and
   the *result* — plain text, no `{{ }}` left in it — is written to the
   destination.

`infra/vault/vault-server-prod.hcl` used to be the second kind —
`vault-server-prod.hcl.j2`, an ordinary Vault HCL config file except three
lines held `{{ vault_kms_key_id }}` and friends instead of a literal value,
rendered once at deploy time the same way `bootstrap_db_password` gets
computed. See the dated Update section near the end of this note for why
that stopped being true: those three values now flow in as environment
variables instead, not through a rendered file at all. The concept above
is still exactly how Ansible's `template:` module works elsewhere in this
project (and worth knowing for the next time a config value genuinely
does need per-deploy rendering) — this just isn't a live example of it
anymore.

---

## The Decision

Chose: a three-file split —
- `docker-compose.yml` (base): image tags, plus **any config that is
  identical in every environment** — `vault-agent`'s volumes, entrypoint,
  and healthcheck belong here, because Vault Agent needs to render
  `db_password` and prove it did so, in dev exactly as much as in prod.
- `docker-compose.dev.yml`: config that is **only correct for a developer's
  laptop** — exposed ports for GUI tools (`5432`, `8200`), Vault's dev-mode
  auto-unseal root token, Keycloak's `start-dev` + bootstrap admin account.
- `docker-compose.prod.yml`: config that is **only correct on the real
  server** — a production Vault listener/storage config, Keycloak without
  `start-dev`, no host-exposed `db`/`vault` ports.

Because: this keeps every piece of "same everywhere" config in exactly one
place. A future change to `vault-agent`'s healthcheck now has nowhere to
accidentally go except the one file every environment loads.

Alternative: fully independent, non-overlaid Compose files per environment
(no base file at all — `docker-compose.dev.yml` and `docker-compose.prod.yml`
each completely self-contained).

Drawback of alternative: every shared piece — labels, volumes, the
healthcheck — has to be hand-copied into both files and manually kept in
sync forever. That's the exact failure mode that produced this bug in the
first place, just duplicated across two files instead of missing from one.

---

## Worked Example

This example is NOT the board game platform's compose files. It's a
stripped-down two-service app (`web` + `cache`) so you can see the merge
mechanics in isolation.

### Scenario

A `web` service and a `redis` cache. In dev you want redis's port exposed
to the host so you can poke at it with `redis-cli` from your laptop. In
prod you want `web` to run more replicas and you never want redis's port
reachable from outside the Docker network at all.

### Code / Configuration

`docker-compose.yml` (base — loaded in every environment):
```yaml
services:
  web:
    image: myapp/web:1.4.0
    environment:
      # Present in every environment; the *value* varies by environment
      # (dev vs prod), but the *key* existing at all does not.
      REDIS_URL: redis://cache:6379
    depends_on:
      cache:
        condition: service_healthy

  cache:
    image: redis:7-alpine
    # This healthcheck is not a "dev thing" or a "prod thing" — web's
    # depends_on needs it to exist regardless of environment. This is the
    # exact class of config that caused the vault-agent bug when it lived
    # in the wrong file.
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 10
```

`docker-compose.dev.yml` (dev-only additions):
```yaml
services:
  cache:
    # Only useful for a human on the host running redis-cli by hand.
    # Never wanted in prod — nothing in prod's network needs to reach
    # redis from outside the Docker network.
    ports:
      - "6379:6379"
```

`docker-compose.prod.yml` (prod-only additions):
```yaml
services:
  web:
    deploy:
      replicas: 3
```

Run dev with:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```
Run prod with:
```
infra/ansible/deploy.sh
```

### What Is Happening Step by Step

1. **Compose reads files left to right.** `docker-compose.yml` is parsed
   first, establishing `web` and `cache` with their base config.
2. **Each later file is merged on top**, service by service, key by key —
   not replaced wholesale. `docker-compose.dev.yml` only mentions `cache`,
   so `web` from the base file is untouched.
3. **Merge rules differ by key type.** `ports:` is a list — the dev file's
   `ports:` entry is *added* to whatever the base file had (here, nothing).
   `environment:`/`labels:` are maps — a later file can add or override
   individual keys without disturbing others. But `command:`/`entrypoint:`
   are **not** merged — if a later file sets either, it fully **replaces**
   the earlier file's value. This is the single most common Compose-overlay
   mistake: assuming everything merges like `environment:` does.
4. **`healthcheck:` lives in the base file** because both dev and prod need
   `web`'s `depends_on: condition: service_healthy` to actually resolve —
   there's no version of this app where that dependency shouldn't exist.

### What Would Break If You Changed X?

If `cache`'s `healthcheck:` were moved into `docker-compose.dev.yml` only
(mirroring the real bug), running prod with just `-f docker-compose.yml -f
docker-compose.prod.yml` would leave `cache` with no healthcheck at all.
`web`'s `depends_on: condition: service_healthy` has nothing to evaluate,
and Compose refuses to start `web` — precisely what just happened with
`vault-agent` and `api`.

---

## Now Apply It

Files to look at after this note:
- [docker-compose.yml](../docker-compose.yml) — currently only `image:` for
  `db`/`keycloak`/`vault`/`vault-bootstrap`/`vault-agent`. After this topic,
  it gains the environment-agnostic pieces (volumes, entrypoints,
  `vault-agent`'s healthcheck, `depends_on` chains).
- [docker-compose.dev.yml](../docker-compose.dev.yml) — keeps only what's
  genuinely dev-only: exposed ports, Vault dev-mode token, Keycloak
  `start-dev` + bootstrap admin.
- `docker-compose.prod.yml` (new) — production equivalents: a real Vault
  server config (not dev-mode), Keycloak without `start-dev`, no exposed
  `db`/`vault` ports.
- [infra/ansible/roles/app_deploy/tasks/main.yml](../infra/ansible/roles/app_deploy/tasks/main.yml) —
  the `docker compose -f docker-compose.yml up -d --build` command becomes
  `-f docker-compose.yml -f docker-compose.prod.yml`.

---

## SecOps Notes

This topic directly determines Vault's production posture — see
`references/secops.md`'s Secrets Management checklist:

- **Vault unsealing strategy must be genuinely documented for prod.** Dev
  mode auto-unseals using a hardcoded root token (`VAULT_DEV_ROOT_TOKEN_ID`)
  — that is only acceptable because dev Vault holds nothing but a
  throwaway local DB password. Production Vault must not run in dev mode:
  a leaked root token in prod means every secret Vault holds is
  compromised, permanently, until every one of them is rotated.
- **No plaintext secrets in Compose files.** `DB_PASSWORD` still reaches
  `docker compose up` as a literal environment variable in the SSH command
  (see `tasks/main.yml`'s `no_log: true` on that task) — that's an accepted
  existing tradeoff (it's generated fresh every run and never written to
  disk on the server), not something this topic changes.
- **Vault Agent configured to renew leases and restart on failure** — worth
  checking `infra/vault/agent.hcl` once a real (non-dev-mode) Vault backend
  exists, since token TTLs behave differently outside dev mode.

What would go wrong if this step were skipped: production would keep running
Vault in dev mode indefinitely — workable for a single low-stakes VM today,
but a real security gap the moment this holds anything more sensitive than
a local Postgres password.

---

## What Was Actually Built (Beyond the Original Sketch)

The predict/generate conversation surfaced three things this note's first
draft didn't cover — each one because implementing the compose split
honestly required an answer, not because they were planned in advance.

**Keycloak needed real exposure, which needed a design choice.**
`apps/web/.env.example`'s `AUTH_KEYCLOAK_ISSUER` proved the end user's
*browser* is redirected straight to Keycloak for login (standard OIDC
Authorization Code flow) — dev's exposed port only works because the
browser and the container share a machine. Prod has no equivalent
shortcut, and nothing routed to Keycloak through Traefik existed yet at
all. Two ways to give Keycloak a real public path were considered:
`KC_HTTP_RELATIVE_PATH=/auth` (make Keycloak itself aware it's served
under `/auth`), or a Traefik StripPrefix middleware (Keycloak stays
unaware of any prefix; Traefik removes it before forwarding) — exactly the
pattern `api`'s router already uses. StripPrefix won: it's proven,
symmetric with `api`, and doesn't risk touching `apps/api`'s existing
`KEYCLOAK_URL=http://keycloak:8080` (a direct, Traefik-bypassing
container-to-container call that has nothing to do with the browser-facing
path at all, and would have needed its own update under the relative-path
approach).

**Real Vault needs unsealing, which needs a decision about where trust
lives.** Dev-mode Vault auto-unseals using a baked-in root token; real
Vault requires a storage backend and, after every restart, someone or
something proving they're allowed to unseal it. Three options were
weighed:
- Manual unseal (an operator runs `vault operator unseal` by hand each
  restart) — simplest, zero new infra, but not automatic.
- Unseal keys stored as plain Infisical secrets, fetched and applied by a
  script — automatic, but collapses Shamir's split-trust guarantee: one
  Infisical login (a copyable credential) becomes sufficient to unseal
  Vault entirely, from anywhere.
- OCI KMS auto-unseal — automatic, and narrows "who can unseal" down to
  "code actually running on this one VM" (an instance principal, verified
  by the cloud platform itself), which can't be copied to a different
  machine the way a login can.

OCI KMS won. `infra/terraform/vault.tf` provisions a **Standard** vault
(`vault_type = "DEFAULT"`) — not the dedicated **Virtual Private Vault**
tier, which runs several $/hour — with a single `SOFTWARE`-protected key
(not the `HSM` default) to stay inside Always Free's limited monthly
allowance of HSM key-versions. That's a real, explicitly-flagged tradeoff:
`vault.tf`'s `TODO(security)` comment marks it as something to revisit if
this Vault instance ever holds more than a single Postgres password, or if
OCI's free HSM allowance turns out to comfortably cover one key after all.

**AppRole replaced the shared root token for vault-agent/vault-bootstrap.**
`agent.hcl`'s own comment (written back in Phase 3) already flagged this:
*"A real deployment (Phase 4) would swap this whole 'method' block for
'approle' instead."* Each of vault-agent and vault-bootstrap now gets its
own AppRole role (`infra/vault/policies/vault-agent.hcl`,
`vault-bootstrap.hcl`) — a scoped policy, a short token TTL, and a
`role_id`/`secret_id` pair instead of one token that could read or write
anything. Because minting these requires an already-initialized,
already-unsealed Vault — and because generating a root token and AppRole
secrets is exactly the kind of operation that should happen in front of a
human, not inside an unattended `ansible-playbook` run —
`infra/vault/bootstrap-prod-init.sh` exists as a **one-time, human-run**
script (`docker compose ... exec vault sh < bootstrap-prod-init.sh`, no
port or SSH tunnel needed), separate from `bootstrap-prod.sh` (which runs
on every single deploy, fully unattended, using the credentials the
one-time script produced).

This creates a real bootstrapping order dependency: on a server's very
first deploy, Vault exists but isn't initialized, so no AppRole
credentials exist yet either. `app_deploy/tasks/main.yml` handles this by
skipping the credential-delivery tasks entirely when the corresponding
Ansible vars are empty (their `defaults/main.yml` default) rather than
failing the whole playbook — `vault-agent`/`vault-bootstrap`/`db` simply
won't come up healthy until `bootstrap-prod-init.sh` has been run once and
`ansible-playbook` is re-run with real values. Everything else in the
stack (keycloak, api, web, traefik) comes up fine in the meantime.

**Known gap, not addressed here:** none of this touches how a real `.env`
file (holding `DOMAIN_NAME`, `KEYCLOAK_ADMIN_PASSWORD`, etc.) actually gets
onto the server in the first place — `docker-compose`'s `${VAR}`
substitution reads it from `deploy_dir`, but no Ansible task creates or
delivers one today. That's a separate, still-open piece of this same
"environments" topic, worth its own pass.

---

## Update — 2026-07-29: What Actually Broke on the Real Deploy, and Why

Everything above was designed and validated with `terraform validate`,
`docker compose config`, and Ansible syntax-checks — all necessary, none
sufficient. Running the real playbook against the real server surfaced
four more bugs, each a genuine root cause, not a symptom of the same one
thing:

**1. `vault-server.hcl` was unreadable to the process reading it.**
`mode: "0600"`, root-owned — but the Vault image's own
`docker-entrypoint.sh` drops from root to a non-root `vault` user (uid
100, gid 1000, confirmed via the image's own `/etc/passwd`) before running
`vault server`. `0644` fixed it; the content was never secret in the
first place (an OCID and two URLs).

**2. The raft storage volume had the identical problem, one level
deeper.** `docker-entrypoint.sh` auto-`chown`s `/vault/config`,
`/vault/logs`, and `/vault/file` when it detects they're bind-mounted with
foreign ownership — but not `/vault/data`, which is what this project's
`storage "raft"` stanza actually uses. A fresh named volume defaults to
root ownership; the non-root `vault` user couldn't write to it at all.
Fixed with a small one-shot `vault-data-permissions` service (plain
`alpine` image, `chown -R 100:1000 /vault/data`, `restart: "no"`) that
`vault` now depends on via `condition: service_completed_successfully`.

**3. A genuine Vault bug, not a permissions problem at all: "more than one
enabled seal found."** Reproduced even against a completely fresh raft
volume (ruling out stale state from earlier failed attempts) — confirmed
via HashiCorp's own support documentation, which describes a known
parsing issue for `key_id` specifically inside a `seal "ocikms" { ... }`
config-file block. The documented workaround: supply
`VAULT_OCIKMS_SEAL_KEY_ID`/`VAULT_OCIKMS_CRYPTO_ENDPOINT`/
`VAULT_OCIKMS_MANAGEMENT_ENDPOINT` as environment variables instead of
config-file values. `vault-server-prod.hcl` no longer has a `seal` block
at all — `docker-compose.prod.yml`'s `vault` service supplies those three
via `environment:` now, and `vault_kms_key_id`/etc. flow straight from
Ansible's `set_fact` into that same `docker compose up` invocation's own
environment, the same way `bootstrap_db_password` already did — no
rendered file needed for this at all anymore.

**4. The hang itself, isolated and verified empirically, not assumed.**
`bootstrap-prod.sh`'s wait loop (`until vault status; do sleep 1; done`)
had no bound — on a server where Vault has never been initialized, that
condition can never become true, so `vault-agent`'s `depends_on:
condition: service_completed_successfully` waits on an exit that will
never come. Two synthetic Compose tests (a fake "dep" service that always
exits 1, a "waiter" depending on it) confirmed precisely what fixes this:
with `restart: on-failure` on the failing dependency, `docker compose up`
hung past 25 seconds; with `restart: "no"`, it failed in ~1.5 seconds with
a clear `"didn't complete successfully"` error. Both changes were needed
together — `bootstrap-prod.sh` now gives up after 30 attempts with an
actionable error message, and `vault-bootstrap`'s restart policy is now
`"no"`, not `on-failure`. A third synthetic test confirmed a failed
dependency chain doesn't block *unrelated* services in the same `up`
invocation — `traefik`/`keycloak` still start fine even while
`vault-bootstrap` → `vault-agent` → `db`/`api` is stuck.

**Still open, hit in this same debugging session but not fixed here:**
Keycloak crash-looping with `bootstrap-admin-username available only when
bootstrap admin password is set` — traced to there being no real `.env`
file on the server at all (`docker compose config` shows every
`${DOMAIN_NAME}`/`${KEYCLOAK_ADMIN_*}` reference resolving to an empty
string). This is exactly the "known gap" flagged earlier in this note:
nothing yet delivers a real `.env` to the server. Worth its own pass.

---

## Update — 2026-08-14: A Fifth Bug, and Why "docker compose up" Was Hanging Again

The OCI KMS seal fix above (moving `seal "ocikms"` out of the HCL file and
into `VAULT_OCIKMS_*` environment variables) introduced a new bug of its
own, with the same symptom as bug #4 above: `docker compose up -d --build`
hanging indefinitely on the real server, this time even though
`vault-bootstrap`'s own bounded retry (bug #4's fix) was working exactly
as designed.

**Root cause: `vault`'s own `command:` was passing `-config` twice.** The
official Vault image's `docker-entrypoint.sh` has a special case —
whenever the first argument is literally `server`, it unconditionally
prepends `-config="$VAULT_CONFIG_DIR"` (the whole `/vault/config`
directory) before appending whatever args the container's own `command:`
supplies. `docker-compose.prod.yml`'s `vault` service had
`command: ["server", "-config=/vault/config/vault-server.hcl"]` — combined
with entrypoint's own prepended flag, Vault actually launched as:

```
vault server -config=/vault/config -config=/vault/config/vault-server.hcl
```

Since `vault-server.hcl` is the *only* file in `/vault/config`, both flags
load the identical `listener "tcp" { address = "0.0.0.0:8200" }` stanza —
in the same process. The first listener binds fine; the second, identical
one fails with `address already in use`, and Vault exits. Found by reading
the entrypoint script itself (`docker run --rm --entrypoint cat
hashicorp/vault:1.18 /usr/local/bin/docker-entrypoint.sh`), not by
guessing from the error message, since "address already in use" reads like
a stale-container/networking problem and isn't one here. Fix: drop the
explicit `-config` flag entirely — `command: ["server"]` — and let
entrypoint's own automatic directory-level `-config` do the one and only
load.

**Why this reproduced a hang, not just a crash-loop:** `vault` has
`restart: unless-stopped`, which (unlike `vault-bootstrap`'s deliberate
`restart: "no"`, bug #4's fix) has no terminal failure state — it retries
forever. `docker compose up` waiting on a container stuck in an endless
restart loop is exactly the same underlying failure mode as bug #4, just
one level higher in the dependency chain (`vault-bootstrap` depends on
`vault` merely having *started* once, which a crash-looping container
technically satisfies — but Compose's own reconciliation still doesn't
seem to reach a terminal state while the container it's watching keeps
dying and restarting). The fix for bug #4 only ever addressed
`vault-bootstrap` specifically; it was never a general guarantee that
*any* crash-looping service in this stack won't reproduce the same hang.

Verified directly against the real server (not assumed): recreating just
`vault` with the fixed `command:` left it in a stable `Up` state, logging
the expected `failed to unseal core: stored unseal keys are supported, but
none were found` (correct — this server has never been through `vault
operator init`). Re-running the full `docker compose up -d --build` then
returned in about 35 seconds with a clean `service "vault-bootstrap"
didn't complete successfully: exit 1`, instead of hanging.

---

## Checkpoint Questions

1. Compose merges `environment:`/`labels:` key-by-key across `-f` files, but
   replaces `command:`/`entrypoint:` wholesale. Why does that distinction
   exist, and where in the worked example would it have bitten you if you
   assumed everything merges like a map?
2. If `vault-agent`'s healthcheck had been left in `docker-compose.dev.yml`
   only, what's the first symptom you'd see in production, and which
   `docker compose` command would you run by hand to confirm it (as
   opposed to re-running the whole Ansible playbook)?
3. Why does `vault-agent`'s `volumes:`/`entrypoint:`/`healthcheck:` belong
   in the base file, while `VAULT_DEV_ROOT_TOKEN_ID` belongs in the dev-only
   file?
4. What would happen if `docker-compose.prod.yml` also exposed port `5432`
   for `db`, the way `docker-compose.dev.yml` does?
5. Why can't production reasonably keep running Vault in dev mode
   long-term, even though it "works" today?
6. Why does Keycloak's Traefik router use a StripPrefix middleware instead
   of `KC_HTTP_RELATIVE_PATH`, and what would have needed to change
   elsewhere if the relative-path approach had been used instead?
7. Why does OCI KMS auto-unseal not have the same "one leaked credential
   unseals everything" problem that storing raw unseal keys in Infisical
   would have?
8. Why does `bootstrap-prod-init.sh` have to be a separate, human-run
   script instead of just another task in `app_deploy/tasks/main.yml`?
9. On a brand new server's very first deploy, `vault-agent` and `db` won't
   come up healthy. Why not, and what specifically has to happen before a
   second `ansible-playbook` run fixes that?
10. `terraform validate`, `docker compose config`, and an Ansible
    syntax-check all passed before this was ever deployed for real — none
    of them caught any of the four bugs in the Update section above. What
    class of bug do each of those tools actually check for, and why was
    that never going to be enough here?
11. Why does `docker-entrypoint.sh` auto-fix ownership of `/vault/config`
    but not `/vault/data`? What would you check first if a *different*
    bind-mounted or volume-mounted path started throwing a permission
    error like this in the future?
12. Walk through why `restart: on-failure` made `docker compose up` hang
    but `restart: "no"` made it fail in under 2 seconds — both on a
    dependency that fails every single time. What is Compose actually
    waiting for in the `on-failure` case that never resolves?

---

## Rewrite Exercise

Once `docker-compose.yml`, `docker-compose.dev.yml`, and
`docker-compose.prod.yml` are generated and you've read through them,
delete all three and reconstruct the three-way split from memory —
starting from a single merged mental model of "everything `db`, `keycloak`,
`vault`, `vault-bootstrap`, and `vault-agent` need to run correctly in both
places," and only then deciding, key by key, which file each piece
belongs in.

Focus on: for each service, correctly separating "identical in every
environment" from "differs by environment" — that's the exact judgment call
that went wrong the first time around.

It's fine if your version differs from the generated one — what matters is
that you can explain, for every key, *why* it lives in the file it's in.

---

## Summary

[To be filled in by Claude Code after checkpoint.]
