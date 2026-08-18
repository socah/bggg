# Database Migrations

`apps/api` uses TypeORM entities with `synchronize: false` — the app never
alters the schema itself. What actually changes the schema is a set of
versioned migration files under `apps/api/src/migrations/`, run through
TypeORM's CLI.

## Why not `synchronize: true`?

TypeORM's auto-sync compares entity metadata to the live database and
issues whatever `ALTER TABLE`s close the gap — including dropping a column
it thinks is no longer needed. That's fine for a throwaway prototype and
dangerous for anything with real data: a renamed or reordered decorator can
read as "drop this column, add that one" and silently lose data. Migrations
are the explicit, reviewable alternative: every schema change is a checked-in
file with an `up()` (and ideally a `down()`) that a human wrote and can read
back before it runs.

## How this project adopted migrations

Before this, schema changes lived only in `db/schema.sql` — a hand-maintained
SQL file, applied by a human running `make apply-schema` (dev) or copying
SQL over SSH (prod). That's how `groups.is_solo` shipped without ever
reaching production's actual database: the dev step ran, the prod step
didn't, and every `GET /groups` in production started 500ing. See
`docs/superpowers/specs/2026-08-18-typeorm-migrations-design.md` for the full
incident and design writeup.

The fix wasn't a new ORM or a new process — it was making the existing
`synchronize: false` intent real, by adopting TypeORM's own migration
runner mid-project:

- **`apps/api/src/migrations/1787081098000-Baseline.ts`** is the adoption
  point. Its `up()` is every statement `db/schema.sql` already had —
  written the same idempotent `IF NOT EXISTS` way — plus the `is_solo`
  column/index as real, executed SQL instead of a comment. Running it
  against a brand new database creates everything; running it against an
  already-fully-caught-up database is a no-op; running it against
  production's actual state (tables existing, `is_solo` missing) is what
  finally closes that specific gap for good. Its `down()` deliberately
  throws — reverting "create the whole schema" isn't a safe automatic
  operation.
- `db/schema.sql` stays as human-readable reference documentation (that was
  always its stated purpose) but is no longer what's actually applied
  anywhere — its header says so explicitly now.

## Running migrations

**Dev:** `make migrate` (also runs automatically as part of `make
reset-dev`). Waits for Postgres to accept connections, then runs
`npm run migration:run --workspace=apps/api` against `localhost` (the host
port `docker-compose.dev.yml` publishes).

**Prod:** runs automatically, as the last two tasks in
`infra/ansible/roles/app_deploy/tasks/main.yml`, every deploy. It waits for
Postgres inside the `db` container, then execs into the already-running
`api` container and runs the plain (non-ts-node) TypeORM CLI against the
*compiled* `apps/api/dist/data-source.js` — the production image prunes
devDependencies and removes `npm`/`npx` entirely (see `apps/api/Dockerfile`),
so neither `ts-node` nor an `npm run` script is available inside it, only
`node` and whatever `npm prune --omit=dev` left behind (TypeORM itself is a
normal dependency, so its CLI entrypoint survives).

**Writing a new migration:** change the entity, then
`npm run migration:generate --workspace=apps/api -- src/migrations/DescriptiveName`
to have TypeORM diff entity metadata against your local dev database and
generate the SQL, or write one by hand for anything TypeORM's diff can't
express (data backfills, non-trivial constraint changes). Review the
generated file before committing it — this is the whole point of migrations
over `synchronize: true`.

`apps/api/src/data-source.ts` is the standalone `DataSource` the CLI needs
(outside Nest's DI container); it shares its connection config with
`AppModule`'s `TypeOrmModule.forRoot()` via
`apps/api/src/config/database.config.ts`, so the two can't drift on
host/port/credentials the way the schema itself once did.

## Known gap

There's no CI check that a given entity change actually shipped a matching
migration — `migration:generate` producing a non-empty diff against `main`
would catch that class of drift automatically. Not built yet; worth adding
if this project sees another entity/schema mismatch.
