# GitHub Actions CI/CD — Lint, Test, npm audit, Trivy Scan, SSH Deploy

**Phase:** 4 — Cloud Infrastructure & Hardening
**Topic ID:** `4_github_actions`
**Date:** 2026-07-18
**SecOps:** Yes

---

## What Is This?

GitHub Actions is GitHub's built-in automation runner: you describe a
pipeline as YAML in `.github/workflows/`, and GitHub spins up a fresh
throwaway VM ("runner") to execute it every time a trigger event (a push, a
pull request) happens. A CI/CD pipeline is that description, structured as a
sequence of gates: lint the code, run the tests, check dependencies for known
vulnerabilities, scan the built container images, and — only if every gate
passed — deploy to production.

---

## Why Does It Matter for This Project?

Right now, "does this change break anything" is answered by you running
`npm run lint` and `npm test` locally, if you remember to. And deploying
means manually running `ansible-playbook` against the production host,
whatever state your local branch happens to be in. A CI/CD pipeline makes
both of those automatic and non-negotiable — a broken test or a critical CVE
in a dependency stops the deploy before it ever reaches the Oracle Cloud VM,
and nobody has to remember to check.

---

## The Decision

This topic actually involves two separate decisions.

**Decision 1 — what CI builds vs. what it deploys**

Chose: CI lints, tests, audits, and Trivy-scans locally-built Docker images
purely as *quality gates*. The actual production deploy still has the
server build its own images from source, exactly like it does today.

Because: `infra/ansible/roles/app_deploy/tasks/main.yml` already clones the
repo directly onto the VM and runs `docker compose up -d --build` there —
the server builds its own images from source, there's no container
registry anywhere in this project. Trivy scanning a CI-built image tells
you the *same Dockerfile* would produce a vulnerable image if built
right now, which is exactly what's about to happen on the server.

Alternative: Build images in CI, push them to a registry (GHCR / Docker
Hub), and change the Ansible role to `docker compose pull` instead of
`--build`.

Drawback of alternative: Requires registry credentials, an image tagging
scheme, and rewriting `app_deploy` — real infrastructure work, for a
single-VM personal project where the few extra seconds of `--build` on
the server cost nothing.

**Decision 2 — how CI actually deploys**

Chose: Install Ansible on the GitHub-hosted runner, write `inventory.ini`
from GitHub Secrets, and run the *exact same*
`infra/ansible/playbook.yml` that you'd run by hand.

Because: The `docker` and `app_deploy` roles are already written, already
handle the git-pull-and-rebuild logic, and are the thing you'd want to keep
testing manually anyway. Reusing them means there is exactly one
definition of "how to deploy," not two that can quietly drift apart.

Alternative: Have the runner `ssh` in directly and run a one-line deploy
command (`cd /opt/bggg && git pull && docker compose up -d --build`).

Drawback of alternative: That command duplicates what `app_deploy`
already does. The day someone updates the Ansible role and forgets the
inline SSH command (or the reverse), the two silently disagree about what
"deployed" means.

**A related limitation, true when this topic was first built, no longer
true today** — see the dated Update section near the end of this note for
what changed and why: `generate_inventory.sh` gets the VM's IP with
`terraform output -raw app_server_public_ip`, which only worked because
Terraform's state file sat on *your* machine. This repo had no remote
state backend, so a GitHub Actions runner had no way to read that state,
and the workflow instead read the IP from a GitHub Secret (`PROD_HOST`)
set and updated by hand. `infra/terraform/backend.tf` now configures a
real remote backend (Cloudflare R2), which closed this gap entirely.

---

## Worked Example

This is NOT the board game platform's pipeline. It's a minimal workflow for
a one-file Node.js "app" with no monorepo, no Docker, no deploy step — just
enough to see triggers, jobs, steps, and secrets in isolation.

### Scenario

You have a tiny Express app in a repo by itself. You want every push to
`main` to run its tests, and only if they pass, SSH into a single server and
restart the app.

### Code / Configuration

`.github/workflows/ci.yml`:
```yaml
name: CI

# Runs on every push to main, AND on every pull request targeting main.
# The PR trigger is what actually blocks bad code — it runs before merge,
# giving you a red X on the PR itself, not just a broken main branch after the fact.
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    # A fresh Ubuntu VM, thrown away after this job finishes.
    runs-on: ubuntu-latest
    steps:
      # Without this, the runner is an empty VM with no copy of your repo at all.
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          # Caches ~/.npm keyed on package-lock.json's hash — a second run with
          # an unchanged lockfile skips re-downloading every package from npm.
          cache: 'npm'

      - run: npm ci   # 'ci', not 'install' — installs exactly what's in the
                       # lockfile, and fails instead of silently updating it.
      - run: npm test

  deploy:
    runs-on: ubuntu-latest
    # This is the gate: 'deploy' will not even start unless 'test' finished
    # with a success status. No 'if' condition needed — 'needs' alone blocks it.
    needs: test
    # Second gate: even if 'test' passes on a pull_request build, only a push
    # to main should ever deploy. Without this, opening a PR from a fork
    # could trigger a production deploy.
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      # webfactory/ssh-agent loads a private key into an in-memory ssh-agent
      # for this job only. The key text itself lives in GitHub's encrypted
      # Secrets store — ${{ secrets.X }} — never in this YAML file, and
      # GitHub automatically masks any secret value that appears in logs.
      - uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}

      - run: |
          ssh -o StrictHostKeyChecking=no deploy@${{ secrets.PROD_HOST }} \
            "cd /opt/myapp && git pull && systemctl restart myapp"
```

### What Is Happening Step by Step

1. **`on:` defines the triggers.** A push to `main` OR a pull request
   targeting `main` starts a run. These are two different runs of the same
   workflow, not one run reacting to two things.

2. **`jobs.test` runs on a brand-new VM.** `actions/checkout@v4` is the
   first step in almost every job in existence — the runner starts with
   nothing, not even your code.

3. **`cache: 'npm'`** speeds up repeated runs. The cache key is derived from
   `package-lock.json`'s contents, so it's automatically invalidated the
   moment a dependency changes.

4. **`npm ci` before `npm test`.** If `npm ci` fails (e.g., the lockfile is
   out of sync with `package.json`), the job stops there — `npm test` never
   runs, and you get a clear failure reason instead of a confusing test
   error.

5. **`jobs.deploy` declares `needs: test`.** GitHub Actions builds a
   dependency graph from every job's `needs:` — `deploy` is scheduled to
   wait, and if `test` fails, `deploy` is skipped entirely (shown as
   "skipped," not "failed," in the UI).

6. **The `if:` condition on `deploy`** is evaluated even after `needs` is
   satisfied. `github.event_name` and `github.ref` are built-in context
   values GitHub populates for every run — no configuration needed to make
   them available.

7. **`webfactory/ssh-agent` loads the key into `ssh-agent`,** so the plain
   `ssh` command in the next step authenticates without you ever writing the
   key to a file on disk yourself or passing `-i /path/to/key`.

8. **The deploy step is a single `ssh` command.** Everything after the
   hostname runs *on the remote server*, in a login shell — `cd`, `git
   pull`, and `systemctl restart` all execute there, not on the runner.

### What Would Break If You Changed X?

If you deleted `needs: test` from the `deploy` job, both jobs would start
running **at the same time** the moment the workflow triggers — GitHub
Actions runs jobs in parallel by default unless a dependency graph says
otherwise. A broken test suite would no longer block anything; `deploy`
would ssh in and restart the app regardless of whether `test` passed,
failed, or was still running.

---

## Now Apply It

The real workflow follows the same skeleton — `checkout` → environment
setup → gated jobs `needs`-chained together — but with more jobs (lint,
unit+e2e test, `npm audit`, Docker build + Trivy, then deploy) and two
workspaces (`apps/api`, `apps/web`) instead of one.

Files to look at after this note (once generated):
- `.github/workflows/ci.yml` — compare its `jobs.*.needs` chain to the
  two-job example above; look for the same `if:` guard restricting deploy
  to `push` events on `main`.
- `infra/ansible/roles/app_deploy/tasks/main.yml` — this is what the
  `deploy` job triggers on the server; nothing about *how* the deploy
  happens changes, only *what triggers it*.
- `infra/ansible/generate_inventory.sh` — compare how it builds
  `inventory.ini` from `terraform output` locally vs. how the CI job builds
  the same file from GitHub Secrets.

---

## SecOps Notes

This topic is where **Dependency Scanning** from `references/secops.md`
gets wired into the pipeline as an enforced gate, not a manual habit:

- **`npm audit --audit-level=high`** runs for both `apps/api` and
  `apps/web`, before the Docker build step. A `high` or `critical`
  advisory in the dependency tree fails the job outright.
- **Trivy** scans the images built from `apps/api/Dockerfile` and
  `apps/web/Dockerfile` — the exact same Dockerfiles the production server
  itself will build from — failing on `CRITICAL` severity findings.
- **No plaintext secrets anywhere in the workflow YAML.** The SSH private
  key and the production host address are both `${{ secrets.* }}`
  references — GitHub encrypts them at rest, injects them only at runtime,
  and automatically redacts any value it recognizes if it ever appears in
  a log line. This is the same principle `references/secops.md` states
  under Secrets Management: no plaintext credentials in CI environment
  variables.

**What would go wrong if this step were skipped:** without `npm audit` and
Trivy as blocking CI gates, a dependency with a known critical CVE (or a
base image with an unpatched OS package) could be deployed straight to the
internet-facing production VM, and the only way you'd find out is if
something actually got exploited. The whole point of a gate is that it's
not optional and not memory-dependent.

---

## Update — 2026-07-27: Retired `PROD_HOST`, CI Now Reads Real Terraform State + Infisical

Three things changed in the same pass, all consequences of work done after
this topic was originally completed.

**1. `infra/terraform/backend.tf` now configures a real remote state
backend** (Cloudflare R2, S3-compatible) — the gap Decision 2's "related
limitation" paragraph originally described no longer exists. The `deploy`
job now runs `hashicorp/setup-terraform`, `terraform init`, and
`terraform output` itself. Worth being precise about *why* this is safe
with only backend credentials and no OCI credentials at all: `terraform
output` reads already-applied state — it never refreshes against the
cloud provider itself, so it never needs OCI API access, only enough to
read the R2 bucket the state file lives in. `PROD_HOST` is no longer read
anywhere in the workflow; the hand-maintained secret can be deleted once
you're comfortable relying on the new path.

**2. The `4_environments` topic (see `notes/4_environments.md`) added a
Vault OCI KMS auto-unseal setup and AppRole auth for
`vault-agent`/`vault-bootstrap`,** which meant `app_deploy/tasks/main.yml`
gained a task that shells out to `terraform output` on its own for three
Vault/KMS values, plus four AppRole credentials with no default value. A
GitHub-hosted runner has no pre-existing Terraform working directory for
that task's own lookup to fall back on — so the same "Read Terraform
outputs" step added for reason #1 above also captures those three values,
and the workflow passes all seven (three KMS values, four AppRole
secrets) to `ansible-playbook` via `-e`. `app_deploy`'s own local lookup
task is now conditional (`when: vault_kms_key_id | length == 0`)
specifically so it's skipped — not attempted and failed — whenever a
caller (CI or otherwise) already supplied the value directly.

**3. Rather than adding those seven values as seven more GitHub Secrets,
the workflow fetches all of them from Infisical instead** — one
`Infisical/secrets-action@v1.0.12` step (Universal Auth, matching how
`infra/scripts/import-secrets.sh`'s own Universal Auth branch was already
built specifically for unattended use), pulling the entire `/ENV_VARS`
path and exporting it as plain environment variables for every later step
in the job. That path already holds `AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3` (the R2 backend credentials)
*and* is exactly where `bootstrap-prod-init.sh` already tells you to store
the four AppRole values — so one login gets everything, and only 2 GitHub
Secrets exist for this whole job (`INFISICAL_CLIENT_ID`/
`INFISICAL_CLIENT_SECRET`, a machine identity scoped to this project) in
place of what would otherwise have been 7. A secret rotated in Infisical
takes effect on the next run automatically — nothing in this workflow
file or GitHub's Secrets UI needs updating to match, the same "one place
to look" reasoning `infra/terraform/nsg.tf` already applies to firewall
rules.

Until `infra/vault/bootstrap-prod-init.sh` has been run once and its four
AppRole values stored in Infisical, CI deploys will keep silently skipping
Vault/DB bring-up — the exact same graceful-degradation behavior described
in `defaults/main.yml`, not a CI-specific failure mode.

Checkpoint questions 3 and 6 below are answered differently now — see
their updated form.

---

## Checkpoint Questions

1. Why does the Trivy scan job need to run *after* `docker build` — what
   would happen if you tried to run it before the image existed?
2. If the `deploy` job ran even though `lint-and-test` had failed, what
   would be misconfigured, and which YAML key is responsible for
   preventing that?
3. `terraform output` needs only backend (R2) credentials to run in CI, not
   the OCI provider's own credentials. Why is that enough — what does
   `terraform output` actually do (and *not* do) that makes this safe?
4. What specifically stops the SSH private key from leaking into the
   workflow's logs, given that the deploy step's output is fully visible
   in the GitHub Actions UI?
5. Walk through what happens end-to-end when you push a commit directly to
   `main`: which jobs run, in what order, and what would cause the
   pipeline to stop before `deploy` ever starts?
6. Why does `app_deploy`'s own "Read Vault's OCI KMS config from Terraform
   outputs" task need a `when:` guard now, when it didn't need one before
   CI started passing `-e vault_kms_key_id=...`?
7. Fetching seven values from Infisical in one step instead of defining
   seven separate GitHub Secrets means a secret rotation only has to
   happen in one place. What's the tradeoff going the other way — what
   does this workflow now depend on at deploy time that it didn't before,
   and what would happen to a deploy if that dependency were unreachable?

---

## Summary

Built `.github/workflows/ci.yml` with three jobs: `verify` (lint, unit +
e2e tests, and `npm audit --audit-level=high`, matrixed over `apps/api` and
`apps/web`), `build-and-scan` (Docker build + Trivy scan on CRITICAL,
matrixed the same way, running in parallel with `verify`), and `deploy`
(gated on both prior jobs plus `push` to `main`, running the existing
`infra/ansible` playbook against a `PROD_HOST`/`SSH_PRIVATE_KEY` GitHub
Secrets-backed inventory).

The user correctly traced the full push-to-`main` execution path
unprompted, then asked two questions that went beyond the checkpoint
script: whether `deploy` should also run Terraform (answered: no — no
remote state backend exists yet, and infra changes are deliberately kept
a manual, human-reviewed step, unlike routine app deploys), and whether
Dependabot is still needed alongside `npm audit` in CI (answered: yes —
Dependabot is the proactive remediation half on a schedule, `npm audit`
is the immediate enforcement gate on every push, and Dependabot's own PRs
get checked by that same gate before merging).

On direct checkpoint questioning, correctly identified — after one
guided follow-up — that `npm audit` shares `verify`'s job (rather than
getting a separate parallel job like `build-and-scan` did) specifically
because it depends on the same `npm ci` lint/test already paid for, not
merely because it's cheap to run. No gaps to revisit.
