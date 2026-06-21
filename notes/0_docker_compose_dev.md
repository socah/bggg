# Docker Compose for Dev — Services, Volumes, Networking, Hot Reload

**Phase:** 0 — Dev Environment
**Topic ID:** 0_docker_compose_dev
**Date:** 2026-06-22
**SecOps:** No

---

## What Is This?

**Docker Compose** is a tool for defining and running multi-container
applications. Instead of running `docker run ...` with a long list of flags
for each container, you describe all your services in a single YAML file
(`docker-compose.dev.yml`) and start them all with one command:
`docker compose up`.

Each **service** in the file becomes one container. Services can communicate
with each other over a private **network** that Compose creates automatically.
**Volumes** persist data across container restarts and can also be used to
mount your source code into a container so changes are picked up immediately
without rebuilding the image — this is **hot reload**.

---

## Why Does It Matter for This Project?

The board game platform needs at minimum three processes to run locally:
a PostgreSQL database, the NestJS API, and the Next.js frontend. Without
Compose, starting the dev stack means three separate `docker run` commands
with manually specified ports, network names, and environment variables —
and if any container is recreated, the others can't find it by name anymore.
Compose solves this: one `docker compose up` starts everything, wires up
networking by service name (`db`, `api`, `web`), and keeps volumes alive
across restarts so your database data survives.

---

## The Decision

**Chose:** A separate `docker-compose.dev.yml` rather than the default
`docker-compose.yml`.

**Because:** We will eventually have a production Compose file too
(`docker-compose.prod.yml`). Naming them explicitly prevents accidentally
running dev configuration in production. The `-f` flag selects which file
to use: `docker compose -f docker-compose.dev.yml up`.

**Alternative:** Use the default `docker-compose.yml` filename.

**Drawback of alternative:** Ambiguity when a production file is added.
The default filename gives no signal about which environment it targets.

---

**Chose:** A named volume for PostgreSQL data, a bind mount for application
source code.

**Because:** Named volumes are managed by Docker and survive container
recreation — your database rows persist even if you run `docker compose down`
and `up` again. Bind mounts project a folder from your host (or devcontainer)
into the container in real time — when you save a TypeScript file, the
container sees the change immediately, enabling hot reload.

**Alternative:** Store Postgres data in a bind mount (e.g. `./data/postgres`).

**Drawback of alternative:** Docker on Windows/Mac runs Linux VMs under the
hood; bind mounts across the VM boundary are significantly slower than named
volumes for database I/O. Use named volumes for databases, bind mounts for
source code.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A small Node.js API that reads from a PostgreSQL database. Both run as
containers. The API restarts automatically when source files change.

### docker-compose.dev.yml

```yaml
# Compose file version is omitted — modern Docker Compose infers it.
# If you see 'version: "3.8"' in older files, it is now optional.

services:

  db:
    image: postgres:16-alpine
    # Environment variables configure the Postgres instance on first start.
    # POSTGRES_DB creates the named database; without it you only get 'postgres'.
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    # Named volume: Docker manages this directory; data persists across restarts.
    volumes:
      - db_data:/var/lib/postgresql/data
    # Expose port 5432 to the host so a GUI tool (e.g. TablePlus) can connect.
    # Other containers reach 'db' by service name — they don't need this.
    ports:
      - "5432:5432"

  api:
    # Build from a Dockerfile in ./apps/api instead of pulling a pre-built image.
    build:
      context: ./apps/api
      dockerfile: Dockerfile.dev
    # Bind mount: live-syncs ./apps/api/src on the host into /app/src in the container.
    # The running process sees file changes without a container rebuild.
    volumes:
      - ./apps/api/src:/app/src
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://app:secret@db:5432/appdb
    # Do not start the api until db is running.
    # Note: 'running' ≠ 'ready to accept connections' — health checks fix that.
    depends_on:
      - db

# Named volumes are declared here at the top level.
# Without this block, the 'db_data' reference above would cause an error.
volumes:
  db_data:
```

### What Is Happening Step by Step

1. **`services`** — each key (`db`, `api`) becomes one container. The key name
   is also the DNS hostname on the Compose network. `api` can reach `db` at
   `db:5432` — not `localhost:5432`, because each container has its own
   `localhost`.

2. **`image: postgres:16-alpine`** — Compose pulls this image from Docker Hub
   if it is not cached locally. `alpine` means a minimal Linux base, smaller
   download and attack surface.

3. **`volumes: - db_data:/var/lib/postgresql/data`** — Docker maps the named
   volume `db_data` to the path inside the container where Postgres stores its
   files. The volume persists even after `docker compose down`. Only
   `docker compose down -v` deletes it.

4. **`ports: - "5432:5432"`** — format is `"host:container"`. This punches
   a hole from your host machine's port 5432 to the container's port 5432.
   Services inside the Compose network do not need this — only external tools
   (TablePlus, your browser) do.

5. **`DATABASE_URL: postgresql://app:secret@db:5432/appdb`** — the hostname
   is `db`, matching the service name. This is how containers find each other
   on the Compose network.

6. **`depends_on: - db`** — Compose starts `db` before `api`. It does NOT
   wait for Postgres to be ready to accept connections — only for the container
   process to start. For full readiness, you would add a `healthcheck` block
   to the `db` service and change `depends_on` to use `condition:
   service_healthy`.

7. **`volumes: db_data:` (top-level)** — declares the named volume so Docker
   knows to create and manage it. Without this declaration, referencing
   `db_data` inside a service causes an error.

### What Would Break If You Used `localhost` Instead of `db` in DATABASE_URL?

If `api` connects to `localhost:5432`, it looks for Postgres on its *own*
container's network interface — where nothing is listening. `localhost` is
not the host machine; it is the container itself. Postgres is running in a
separate container. Compose's internal DNS lets `api` reach `db` by service
name — that is the only correct address.

---

## Now Apply It

In the board game platform, `docker-compose.dev.yml` starts at Postgres only
(Phase 0). Services are added as each is built:

| Phase | Service added |
|-------|--------------|
| 0     | `db` (PostgreSQL) |
| 2     | `api` (NestJS) |
| 3     | `web` (Next.js), `keycloak` |
| 3     | `vault` (HashiCorp Vault) |

Files to look at after this note:
- [docker-compose.dev.yml](../docker-compose.dev.yml) — the actual file; compare
  the `db` service to the worked example above
- [.env.example](../.env.example) — notice that Postgres credentials are now
  added here; the Compose file reads them via `${VAR}` substitution

---

## Checkpoint Questions

1. Why can the `api` container reach Postgres at `db:5432` but NOT at
   `localhost:5432`? What does `localhost` mean inside a container?

2. What is the difference between a named volume and a bind mount? Which
   one would you use for Postgres data, and which for NestJS source code —
   and why?

3. If you run `docker compose down` without any flags, is your Postgres data
   lost? What command would delete it?

4. What does `depends_on` guarantee, and what does it NOT guarantee? What
   would you add to make it wait until Postgres is actually ready?

5. A teammate adds a new environment variable to `apps/api/src/config.ts`
   but forgets to add it to `docker-compose.dev.yml` and `.env.example`.
   What happens when the API container starts?

---

## Rewrite Exercise

`rewrite: true` for this topic.

Delete `docker-compose.dev.yml` and recreate it from memory. Use this note
as a reference for concepts, but not the generated file.

Focus on: the `volumes` block — both the named volume declaration at the top
level AND the correct syntax for the bind mount (`./host/path:/container/path`).
These are the two places people most often make mistakes.

It is fine if your version differs — what matters is that you can explain
every line you write.

---

## Summary

Built: `docker-compose.dev.yml` with a single `db` service (Postgres 16 Alpine), named volume for data persistence, port 5432 exposed for host tools, and credentials via `${VAR}` substitution from `.env`. Updated `.env.example` with the three Postgres variables.

Demonstrated understanding of: Named volumes persist on the host (not inside the container) and survive `docker compose down`; only `down -v` removes them. The container path is a mount point, not where the data actually lives. The top-level `volumes:` declaration is required — a named volume reference inside a service without it is an error.

To revisit: None identified.
