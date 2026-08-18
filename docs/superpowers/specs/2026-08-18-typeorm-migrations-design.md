# Automate schema migrations with TypeORM

**Date:** 2026-08-18

## Problem

`apps/api` runs with `synchronize: false` (correct — auto-sync can silently
drop columns) but has no real migration runner either. Schema changes are
tracked only as hand-written SQL in `db/schema.sql`, applied by a human
running `make apply-schema` (dev) or copy-pasting SQL over SSH (prod). When
`groups.is_solo` was added, the dev step was documented but the equivalent
prod step never ran — every `GET /groups` in production started 500ing
(TypeORM selects a column that doesn't exist), which broke both the group
switcher ("Could not load groups") and the personal schedule view ("Could
not load your schedule", since it fetches `/groups` first). Nothing in the
deploy pipeline would have caught this before users did.

## Goals

- Real, versioned TypeORM migration files are the one mechanism that
  changes any environment's schema from here on — no more "edit the entity,
  remember to also hand-run some SQL somewhere."
- A baseline migration reconciles *any* pre-existing database (a fresh dev
  container, or prod's already-partially-migrated one) to the schema the
  entities actually expect — idempotently, so it's safe to run against a
  database that's already fully caught up.
- Migrations run automatically as part of every deploy — `make apply-schema`
  equivalent for dev, a new Ansible task for prod — so this specific failure
  mode (schema drift shipped, DB never updated) can't recur silently.

## Non-goals

- Not switching ORMs.
- Not ever setting `synchronize: true`.
- Not backfilling a separate historical migration per past schema change —
  one baseline migration capturing "everything up to today," then real
  incremental migrations from here on.
- Not adding a CI check that `migration:generate` produces an empty diff
  (worth doing later; out of scope for this pass).

## Approach

1. Extract the DB-password-from-file logic already in `app.module.ts` into
   a small shared helper, since the CLI `DataSource` needs the identical
   logic and duplicating it is exactly the kind of drift this change is
   trying to eliminate elsewhere.
2. Add `apps/api/src/data-source.ts` — a standalone `DataSource` (same
   connection config as `TypeOrmModule.forRoot`, `synchronize: false`,
   plus `entities`/`migrations` globs) for the TypeORM CLI to use outside
   Nest's DI container.
3. Add `apps/api/src/migrations/`, starting with one baseline migration
   whose `up()` runs today's `db/schema.sql` content as raw SQL — already
   written with `IF NOT EXISTS` throughout — plus the two statements that
   currently only exist as a comment (`ALTER TABLE groups ADD COLUMN IF NOT
   EXISTS is_solo ...`, `CREATE UNIQUE INDEX IF NOT EXISTS
   groups_owner_solo_unique ...`). Idempotent by construction: a no-op
   against a database already fully caught up, a real fix against today's
   production database, and a full bootstrap against a brand new one.
   `down()` is intentionally unsupported (reverting "create everything"
   isn't a safe automated operation).
4. Add `migration:generate` / `migration:run` / `migration:revert` npm
   scripts to `apps/api/package.json` (via `typeorm-ts-node-commonjs` for
   local/dev use against `.ts` sources).
5. Rename the Makefile's `apply-schema` target to `migrate` and change its
   recipe from piping `db/schema.sql` into `psql` to running
   `migration:run` (keeping the existing `pg_isready` wait). Update
   `reset-dev`'s call site.
6. Add two tasks to the end of
   `infra/ansible/roles/app_deploy/tasks/main.yml`: wait for Postgres to
   accept connections, then `docker compose exec -T api node
   node_modules/typeorm/cli.js migration:run -d apps/api/dist/data-source.js`
   — the plain (non-ts-node) CLI entrypoint, since the runtime image prunes
   devDependencies and removes `npm`/`npx` entirely; `data-source.ts`
   compiles to `dist/` via the existing `nest build` step, so nothing else
   in the Dockerfile needs to change.
7. Trim `db/schema.sql`'s header and the now-stale "MANUAL DEPLOY STEP"
   comment block — it stays as human-readable reference documentation (the
   project's existing convention), but is no longer where anyone should
   look for what actually gets applied.
8. New reference doc: `docs/reference/database-migrations.md`, covering the
   baseline-adoption approach, the CLI commands, and where migrations run
   in each environment.

## Risks

- **Baseline migration drifts from `db/schema.sql` in the future** if
  someone edits `schema.sql` without adding a real migration. Mitigated by
  goal #3 above (CI check) being called out as follow-up, and by the
  reference doc stating migrations are now the source of truth.
- **Ordering in the ansible role**: migrations run as a separate `exec`
  step after `api` is already up, not before. If a migration is genuinely
  breaking (removes a column the currently-running code still reads), the
  old `api` process could error between the container starting and the
  migration completing. Acceptable for now — the previous state (manual
  SQL run at some arbitrary, un-coordinated time) was strictly worse, and
  this is a smaller/known gap than what shipped today.
- **Baseline migration is inferred from `db/schema.sql`, not a verified
  diff against production**: `db/schema.sql`'s own comments document past
  drift between it and the entities that got caught and fixed reactively,
  the same class of bug as today's incident. It's the best available
  reconciliation source, and its idempotent `IF NOT EXISTS` construction
  means running it is safe even if it turns out incomplete — but it may
  not catch every drift beyond `is_solo`.
