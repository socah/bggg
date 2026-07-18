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

**A related limitation worth naming explicitly:** `generate_inventory.sh`
gets the VM's IP with `terraform output -raw app_server_public_ip` — but
that only works because Terraform's state file is sitting on *your*
machine. This repo has no remote state backend (nothing in
`infra/terraform/*.tf` configures one), so a GitHub Actions runner has no
way to read that state. The workflow instead reads the IP from a GitHub
Secret (`PROD_HOST`) that you set by hand once, and update by hand if the
VM is ever recreated.

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

## Checkpoint Questions

1. Why does the Trivy scan job need to run *after* `docker build` — what
   would happen if you tried to run it before the image existed?
2. If the `deploy` job ran even though `lint-and-test` had failed, what
   would be misconfigured, and which YAML key is responsible for
   preventing that?
3. Why is the production host's address stored as a GitHub Secret
   (`PROD_HOST`) instead of being fetched dynamically with
   `terraform output`, the way `generate_inventory.sh` does it on your own
   machine?
4. What specifically stops the SSH private key from leaking into the
   workflow's logs, given that the deploy step's output is fully visible
   in the GitHub Actions UI?
5. Walk through what happens end-to-end when you push a commit directly to
   `main`: which jobs run, in what order, and what would cause the
   pipeline to stop before `deploy` ever starts?

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
