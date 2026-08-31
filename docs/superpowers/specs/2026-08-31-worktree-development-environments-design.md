# Worktree Development Environments

## Status

Proposed design for implementation by a separate agent.

## Goal

Make local development setup work from a fresh Git worktree and allow all
worktrees to run simultaneously without manual environment or Keycloak setup.

The desired commands are:

```sh
make dev-setup
make dev-status
make dev-stop
make dev-down

# From the repository root:
make dev-setup-all
make dev-status-all
make dev-stop-all
make dev-down-all
```

The existing application behavior should remain unchanged. This is a local
development orchestration change, not a production deployment change.

## Current Problems

The current `make dev-setup` assumes that the checkout already has a root
`.env`. A new worktree does not contain ignored files from another checkout,
so setup stops before Compose can start.

The current setup also assumes that every checkout owns the same fixed host
ports:

- Web: `3000`
- Keycloak: `8080`
- PostgreSQL: `5432`
- Vault: `8200`

That prevents two worktrees from running at once. The host-side API and web
server process state is also stored in a shared relative `logs/` directory,
which can cause PID and log collisions when commands are run from a common
automation context.

Finally, every new Keycloak data volume generates new confidential-client
secrets. The existing `scripts/sync-dev-secrets.sh` can already retrieve those
secrets through `kcadm`, but the workflow currently requires the environment
file to exist and does not make the complete bootstrap contract explicit.

## Design Decisions

### Isolate complete development stacks

Each worktree gets its own Docker Compose project and persistent volumes. The
stack includes its own PostgreSQL, Keycloak, and Vault services. This avoids
cross-branch state leaks in:

- Database migrations and schema data
- Keycloak realms, users, and client secrets
- Vault development state
- Container names and networks

The first setup of a worktree consumes more resources than sharing one stack,
but it makes branch testing deterministic. Repeated setup reuses the named
volumes and is therefore fast.

### Generate local environment automatically

Setup creates a worktree-local ignored `.env` from `.env.example` if one does
not exist. It must not overwrite an existing `.env` without an explicit reset
command.

The generated file contains the values needed by both Compose and host-side
development processes, including:

- `COMPOSE_PROJECT_NAME`
- Worktree-specific host ports
- Host-facing `DB_HOST`, `KEYCLOAK_URL`, `AUTH_KEYCLOAK_ISSUER`, and `AUTH_URL`
- Safe random local values for development-only secrets that are still
  placeholders in `.env.example`

External credentials such as `BGG_API_TOKEN` and R2 credentials remain user
supplied. If Infisical is installed and configured, the setup may fetch
`BGG_API_TOKEN`; otherwise setup must print a targeted warning rather than
silently creating an invalid value.

### Retrieve Keycloak secrets, never ask the developer to copy them

After the worktree's Keycloak is ready and the realm import has completed,
setup runs the equivalent of `scripts/sync-dev-secrets.sh` against that
worktree's Compose project. It writes the generated `web` and `api-service`
secrets into the worktree `.env`.

The host-side API and web processes start only after this synchronization, so
they always see the correct values. Re-running setup is idempotent and
refreshes the values from the active Keycloak instance if necessary.

### Stable, collision-free port allocation

Port allocation must be deterministic for a worktree and not depend on the
order in which worktrees are discovered. A recommended implementation is to
derive a small numeric slot from a normalized absolute worktree path using a
stable hash, with a configurable base and range.

Each slot reserves a block:

| Service | Port formula |
| --- | --- |
| Web | `3000 + slot * 10` |
| Keycloak | `8080 + slot * 10` |
| PostgreSQL | `5432 + slot * 10` |
| Vault | `8200 + slot * 10` |

The exact slot size and collision handling are implementation details, but
the script must check whether the selected ports are available before startup.
If a hash collision occurs, it should select the next free slot and persist
the chosen slot in the generated `.env` so later commands use the same ports.

The ports used inside the Compose network remain the standard service ports.
Only host-published ports change.

### Keep orchestration in scripts, with Make as the public interface

Make targets should remain small wrappers. A shared script should own:

- Worktree identity and path discovery
- Environment file creation and validation
- Port allocation
- Compose project naming and invocation
- Readiness checks
- Keycloak secret synchronization
- Server PID/log directory selection
- Clear error reporting

This avoids duplicating the same setup logic between local and all-worktrees
commands and makes shell-level tests practical.

## Proposed Components

### Worktree-local helper

Add a script such as `scripts/worktree-dev.sh` with subcommands:

```text
init       Create or validate the worktree .env and derived configuration.
up         Start the isolated infrastructure and wait for readiness.
secrets    Synchronize generated Keycloak client secrets.
setup      Run init, up, secrets, seed, migrations, and host servers.
status     Show ports, Compose project, infrastructure, and app processes.
stop       Stop host-side API/web processes only.
down       Stop and remove the Compose project while retaining volumes.
clean      Remove the Compose project and its volumes after confirmation.
```

The existing `scripts/dev-servers.sh` should be extended or wrapped so its
`PID_DIR` and `LOG_DIR` point at a worktree-specific ignored directory, for
example `.dev/worktree-<slot>/`. It must not use a repository-global PID path
when invoked by the new helper.

### Compose configuration

The Compose files should use environment substitutions for host-published
ports instead of fixed host ports. The service-side ports remain unchanged.
The helper invokes Compose with an explicit `--project-name` derived from the
worktree, rather than relying on the current directory name.

The project name must contain only characters accepted by Compose and be
bounded in length. It should include a readable sanitized worktree name plus a
short stable hash to avoid collisions between similarly named worktrees.

Named volumes will then be isolated automatically by Compose's project name.

### Root all-worktrees helper

Add a repository-root script such as `scripts/worktrees-dev.sh` that reads
`git worktree list --porcelain`, extracts each available worktree path, and
invokes the worktree-local helper in that directory.

The root Make targets should delegate to this script:

- `dev-setup-all`: initialize and start every available worktree
- `dev-status-all`: collect status from every worktree
- `dev-stop-all`: stop host-side app processes in every worktree
- `dev-down-all`: stop each Compose project while retaining volumes
- `dev-clean-all`: remove all worktree infrastructure and volumes only after
  an explicit confirmation flag

The all-worktrees setup should run with bounded parallelism to keep the
workflow quick without starting an unbounded number of Docker builds. A
variable such as `WORKTREE_CONCURRENCY` should default to a conservative value
and be overridable by the developer. One worktree failure must be reported and
must not prevent cleanup/reporting for the other worktrees.

The root command must not assume that the root checkout is the current shell
directory when invoking a linked worktree. It should use `make -C` or an
absolute script path and pass the repository root explicitly where needed.

## Setup Flow

For `make dev-setup` in one worktree:

1. Resolve the current worktree path and repository root.
2. Compute or load the stable worktree slot and Compose project name.
3. Create `.env` from `.env.example` if missing.
4. Generate only missing local development values and write derived host URLs
   and ports.
5. Check for port conflicts and fail before changing containers if a port is
   occupied by an unrelated process.
6. Start `db`, `keycloak`, `vault`, and related infrastructure with the
   explicit Compose project name.
7. Wait for database, Vault, and Keycloak readiness using bounded retries.
8. Synchronize Keycloak-generated client secrets into `.env`.
9. Seed the development user.
10. Run database migrations with host-facing database settings.
11. Start host-side API and web servers using the generated environment.
12. Print the worktree name, Compose project, URLs, and log paths.

For `make dev-setup-all`, the root helper performs the same flow for each
worktree, with bounded parallelism. Each child process receives its own path,
environment file, Compose project, ports, logs, and PID directory.

## Error Handling

- Missing Docker or Docker Compose: fail with an installation/availability
  message.
- Missing `.env.example`: fail without creating a partial environment.
- Existing `.env`: preserve it and only add/update values owned by the helper.
- Invalid placeholder values for required local infrastructure credentials:
  generate safe values where appropriate and identify external credentials that
  still require user action.
- Port conflict: report the service, selected port, and override/reset command.
- Keycloak readiness timeout: include container status and recent logs.
- Secret synchronization failure: do not start host-side app servers.
- Migration failure: leave infrastructure running and print the migration log
  command so the developer can fix the issue and rerun setup.
- One all-worktrees failure: return nonzero after processing all worktrees and
  show a per-worktree summary.

No command should delete volumes by default. Volume removal belongs to an
explicit `clean` target.

## Testing Strategy

Add shell tests alongside the existing script tests covering:

- Fresh worktree with no `.env` creates a valid ignored environment.
- Existing `.env` is preserved and user values are not overwritten.
- Two distinct worktree paths receive distinct stable project names and port
  blocks.
- Repeated allocation for the same path returns the same slot.
- Occupied ports are detected before Compose startup.
- Generated host URLs match the selected ports.
- Keycloak secret synchronization uses the worktree-specific Compose project.
- Server PID and log directories do not overlap.
- `git worktree list --porcelain` parsing handles paths with spaces.
- `dev-setup-all` continues after one worktree fails and returns a summary
  failure status.
- `dev-down` retains volumes, while `dev-clean` removes them only when
  explicitly requested.

Verification should include a real smoke test with two temporary worktrees:

1. Create two linked worktrees.
2. Run `make dev-setup-all` from the repository root.
3. Confirm both Compose projects are running with distinct host ports.
4. Confirm both web URLs and Keycloak URLs respond.
5. Confirm each worktree's API can connect to its own database.
6. Run `make dev-stop-all`, then `make dev-down-all`.
7. Confirm named volumes remain until `make dev-clean-all`.

## Files Likely To Change

- `Makefile`
- `docker-compose.dev.yml`
- `scripts/dev-servers.sh`
- `scripts/sync-dev-secrets.sh`
- New `scripts/worktree-dev.sh`
- New `scripts/worktrees-dev.sh`
- New shell tests for both scripts
- `.gitignore` if a dedicated `.dev/` state directory is introduced
- `.env.example` comments documenting generated worktree values

Avoid changing production Compose files, production deployment scripts, or
application business logic.

## Acceptance Criteria

- A fresh worktree can run `make dev-setup` without manually copying `.env`.
- No manual Keycloak client-secret copying is required.
- Two worktrees can run their complete local stacks simultaneously.
- `make dev-setup-all` discovers and starts all available worktrees from the
  repository root.
- Worktree URLs and logs are printed clearly.
- Existing local secrets and unrelated processes are not destroyed.
- Setup is idempotent.
- All existing tests continue to pass, and the new shell tests pass.
