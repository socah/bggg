# Worktree Development Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Git worktree independently bootstrappable, runnable, and stoppable with deterministic ports, Compose projects, secrets, and process state.

**Architecture:** `scripts/worktree-dev.sh` owns one worktree's derived environment, Compose lifecycle, readiness, secret sync, migrations, and host processes. `scripts/worktrees-dev.sh` discovers worktrees and runs those operations with bounded concurrency and aggregate failure reporting. Make remains a thin public wrapper.

**Tech Stack:** POSIX shell, GNU/BSD-compatible command-line tools, Docker Compose, Make, existing shell test style.

**Spec:** `docs/superpowers/specs/2026-08-31-worktree-development-environments-design.md`

## Global Constraints

- Existing `.env` values must not be overwritten during initialization.
- No command removes volumes by default; only explicit clean removes them.
- Host-published ports vary per worktree; service-side ports remain standard.
- All-worktree setup uses bounded parallelism and reports every failure.
- Unrelated application changes, especially `apps/web/components/calendar-month-grid.tsx`, must remain untouched.

---

### Task 1: Add per-worktree environment and lifecycle helper

**Files:** Create `scripts/worktree-dev.sh`; modify `.env.example`, `.gitignore`, `docker-compose.dev.yml`, `scripts/sync-dev-secrets.sh`, `scripts/dev-servers.sh`, `package.json`.

- [ ] Add deterministic identity, environment bootstrapping, port checks, Compose invocation, readiness retries, secret sync, seed/migration/server lifecycle, status, stop, down, and confirmed clean.
- [ ] Use `.dev/worktree-<slot>` for PID/log state and Compose's explicit project name.
- [ ] Parameterize the four dev Compose host ports and host-side API/web commands.
- [ ] Preserve existing environment values and synchronize only generated Keycloak secrets.

### Task 2: Add root all-worktree orchestration

**Files:** Create `scripts/worktrees-dev.sh`; modify `Makefile`.

- [ ] Parse porcelain worktree paths including spaces.
- [ ] Dispatch lifecycle commands with `WORKTREE_CONCURRENCY`, collect result files, and print a per-worktree summary.
- [ ] Require `--confirm` for all-worktree clean and return nonzero if any child fails.

### Task 3: Add hermetic shell coverage and verify

**Files:** Create `scripts/worktree-dev.test.sh`, `scripts/worktrees-dev.test.sh`; modify `Makefile.test.sh` if needed.

- [ ] Test environment preservation, stable identity, URL derivation, port conflict detection, isolated state paths, Compose project propagation, path parsing, aggregate failures, and clean confirmation.
- [ ] Run all existing and new shell tests plus focused syntax and Compose configuration checks where available.
