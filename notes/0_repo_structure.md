# Monorepo Layout, .env Strategy, Git Setup

**Phase:** 0 — Dev Environment
**Topic ID:** 0_repo_structure
**Date:** 2026-06-21
**SecOps:** No

---

## What Is This?

A **monorepo** is a single Git repository that contains multiple distinct
projects — for example, a backend API, a frontend app, and infrastructure
definitions — living side by side in subdirectories. The alternative is a
**polyrepo**, where each project gets its own repository.

A **.env strategy** is a convention for how you store, share (or deliberately
*not* share), and load environment variables — secrets, ports, feature flags,
database URLs — without ever committing sensitive values to Git.

**Git setup** at project start means establishing `.gitignore`, branch
protection strategy, and commit conventions before any code exists, so bad
habits never get baked in.

---

## Why Does It Matter for This Project?

The board game platform has three moving parts that constantly talk to each
other: a NestJS backend, a Next.js frontend, and Terraform/Ansible
infrastructure code. A monorepo lets you make a single atomic commit that
changes the backend API and the frontend that calls it at the same time —
which matters every time the BGG integration adds a new field. The `.env`
strategy matters because we will eventually store Keycloak secrets, database
passwords, and Vault tokens — any one of which, if committed to Git, becomes
a permanent credential leak even if deleted later.

---

## The Decision

**Chose:** Monorepo with workspace-level `package.json` and two main app
packages (`apps/api`, `apps/web`) plus an `infra/` folder for Terraform.

**Because:** Atomic cross-cutting changes (API contract change + frontend
change) stay in one PR; shared TypeScript types can live in a `packages/`
folder and be imported by both apps; CI can build and test everything from one
place.

**Alternative:** Separate repos for backend, frontend, and infra.

**Drawback of alternative:** Cross-cutting changes become two coordinated PRs
across two repos. Shared types get copy-pasted or published as an npm package,
adding release overhead. Harder to run the full stack locally in one command.

---

**Chose:** `.env.example` committed to Git; actual `.env` files git-ignored.

**Because:** `.env.example` documents every variable a developer needs without
ever containing a real value. The developer copies it to `.env` and fills in
real values locally. CI/CD and production inject variables from a secrets
manager (Vault, GitHub Actions secrets) — never from a committed file.

**Alternative:** Commit `.env` directly to the repo (often seen in tutorials).

**Drawback of alternative:** Credentials are in Git history permanently. Even
a `git rm` does not erase them from all historical commits. A single GitHub
repo scrape exposes them.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

You are building a small app with an Express API and a React frontend. You
want to keep them in one repo and manage environment variables safely.

### Structure

```
my-app/                         ← the Git repository root
├── .gitignore                  ← ignores .env files and node_modules
├── .env.example                ← COMMITTED: documents required vars, no real values
├── .env                        ← NOT committed: real values, only on developer's machine
├── package.json                ← workspace root, coordinates both packages
├── apps/
│   ├── api/                    ← Express backend
│   │   ├── package.json
│   │   └── src/index.ts
│   └── web/                    ← React frontend
│       ├── package.json
│       └── src/App.tsx
└── infra/                      ← infrastructure scripts (empty for now)
```

### .gitignore

```gitignore
# Ignore all real .env files at any depth
.env
.env.local
.env.*.local

# Never ignore the example template
!.env.example

node_modules/
dist/
```

### .env.example

```bash
# Copy this file to .env and fill in real values.
# Do NOT commit .env — it is in .gitignore.

DATABASE_URL=postgresql://user:password@localhost:5432/mydb
API_PORT=3000
JWT_SECRET=replace-with-a-long-random-string
```

### package.json (workspace root)

```json
{
  "name": "my-app",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w apps/api\" \"npm run dev -w apps/web\""
  }
}
```

### What Is Happening Step by Step

1. **`.gitignore` — the safety net.** The rule `.env` prevents Git from ever
   staging a file named `.env`. The `!.env.example` rule is a negation: it
   *un-ignores* that specific file so the template stays in version control.
   Without the `!`, both would be ignored.

2. **`.env.example` — the documentation.** Every variable the app needs is
   listed here with a placeholder value. When a new developer clones the repo
   they run `cp .env.example .env` and know exactly what to fill in. This file
   is always in sync with the code because it lives next to it.

3. **`workspaces: ["apps/*"]` — the monorepo glue.** npm (or pnpm/yarn) will
   hoist dependencies and make `apps/api` and `apps/web` importable as
   workspace packages. The root `scripts.dev` runs both apps in parallel with
   `concurrently`.

4. **`infra/` — a placeholder with intent.** Even empty, creating this folder
   establishes that infrastructure-as-code belongs in the same repo. When
   Terraform arrives in Phase 4, it knows where it lives.

### What Would Break If You Changed `.env` to `.env.production`?

If your `.gitignore` only lists `.env` and you accidentally name your secrets
file `.env.production`, Git would happily track it. If you pushed, every
secret in that file would be in the remote repository's history forever —
even if you deleted the file in the next commit. The mitigation is the blanket
rule `.env*` (matches any file starting with `.env`) combined with the
explicit `!.env.example` exemption.

---

## Now Apply It

In the board game platform, the structure we are about to create is:

```
bggg/
├── .gitignore
├── .env.example
├── apps/
│   ├── api/        ← NestJS (Phase 2)
│   └── web/        ← Next.js (Phase 3)
├── infra/          ← Terraform + Ansible (Phase 4)
└── packages/       ← shared TypeScript types (introduced during Phase 2)
```

Files to look at after this note:
- `.gitignore` — verify `.env*` is excluded and `.env.example` is exempted
- `.env.example` — check that every service variable is documented here
- `package.json` (root) — look at the `workspaces` field and root-level scripts

---

## Checkpoint Questions

1. What is the difference between a monorepo and a polyrepo, and what
   concrete advantage does a monorepo give us when the NestJS API adds a
   new field to a response and the Next.js frontend needs to use it?

2. If a developer accidentally runs `git add .env` and commits it, and then
   immediately removes it in the next commit, is the secret safe? Why or
   why not?

3. What does the `!.env.example` line in `.gitignore` do, and what would
   happen if it were removed?

4. What is the purpose of `workspaces` in the root `package.json`? What
   problem does it solve?

5. Why does `infra/` exist in the repo alongside `apps/`, rather than in a
   separate repository?

---

## Summary

Built: Monorepo scaffold — `.gitignore`, `.env.example`, root `package.json` with npm workspaces, and placeholder folders for `apps/api`, `apps/web`, `infra/`, and `packages/`. No code installed or run, just structure.

Demonstrated understanding of: The purpose of `private: true` (prevents accidental npm publish of the root workspace); how npm workspaces hoist dependencies to a single root `node_modules/`; why `.env.example` is committed while `.env` is not; and how the `-w` flag scopes npm commands to a specific workspace. Also correctly reasoned that `.env.example` should start minimal and grow as services are added rather than being pre-populated speculatively.

To revisit: None identified.
