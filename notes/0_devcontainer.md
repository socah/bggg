# devcontainer.json — Base Image, Features, Extensions, Port Forwarding

**Phase:** 0 — Dev Environment
**Topic ID:** 0_devcontainer
**Date:** 2026-06-21
**SecOps:** No

---

## What Is This?

A **Dev Container** is a Docker container that VS Code (or any Dev Containers-
compatible editor) uses as your development environment instead of your local
machine. The file `.devcontainer/devcontainer.json` describes exactly what
that container should look like: which base image to start from, which tools
to install, which VS Code extensions to activate, and which ports to expose.

When you open a project in a Dev Container, VS Code spins up that container,
mounts your project files into it, and connects the editor to the container's
filesystem and shell. Every terminal you open runs inside the container, not
on your host machine.

---

## Why Does It Matter for This Project?

The platform requires a specific Node version, the Docker CLI (to run
Compose), and a handful of VS Code extensions. Without a devcontainer, the
first question every collaborator asks is "which Node version?" and the first
bug is always "it works on my machine." The devcontainer collapses that to
zero: clone, reopen in container, done. It also means the container that runs
our NestJS app in production is built from the same base image lineage as the
one we develop in — reducing "works in dev, breaks in prod" surprises.

---

## The Decision

**Chose:** `mcr.microsoft.com/devcontainers/typescript-node:20` as base image.

**Because:** Microsoft's official Dev Container images come pre-configured for
VS Code Dev Containers, include a non-root `node` user, and pin a specific
Node LTS version. Using Node 20 matches our `engines` field in `package.json`.

**Alternative:** A plain `node:20-alpine` image.

**Drawback of alternative:** Requires manually configuring the non-root user,
installing git, configuring shell completion, and wiring up VS Code server
support — all of which the Microsoft image does for free. Use a plain image
only if you need a minimal production image; for dev, the Microsoft image
saves real time.

---

**Chose:** Install Docker-in-Docker via a Dev Container **feature**.

**Because:** We need to run `docker compose up` from inside the devcontainer
to start our Postgres and other services. Dev Container features are
pre-packaged install scripts maintained by Microsoft; they handle the socket
forwarding and user permissions automatically.

**Alternative:** Mount the host's Docker socket (`/var/run/docker.sock`) into
the container.

**Drawback of alternative:** Gives the container access to the host Docker
daemon, meaning a compromised container could affect host containers. Docker-
in-Docker is isolated. For a learning project the difference is minor, but the
habit of preferring isolation is worth building.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A small Express API project where two developers want identical environments
without installing Node or npm on their host machines.

### Structure

```
my-api/
├── .devcontainer/
│   └── devcontainer.json   ← the only file needed for a basic devcontainer
├── package.json
└── src/
    └── index.ts
```

### devcontainer.json

```jsonc
{
  // Human-readable name shown in VS Code's status bar
  "name": "My API Dev Container",

  // The Docker image to use as the base environment.
  // This specific tag gives us Node 20 on Debian with a pre-configured
  // non-root 'node' user and VS Code server support.
  "image": "mcr.microsoft.com/devcontainers/typescript-node:20",

  // Features are pre-packaged install scripts.
  // This one installs Docker inside the container so we can run
  // 'docker compose' from the integrated terminal.
  "features": {
    "ghcr.io/devcontainers/features/docker-in-docker:2": {}
  },

  // VS Code extensions to install automatically when the container starts.
  // These are extension IDs from the VS Code marketplace.
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",       // ESLint integration
        "esbenp.prettier-vscode"        // Prettier formatter
      ]
    }
  },

  // Ports to forward from the container to your host browser.
  // Without this, 'localhost:3000' in your browser would not reach
  // the server running inside the container.
  "forwardPorts": [3000],

  // A shell command that runs once after the container is created.
  // Installs npm dependencies automatically on first open.
  "postCreateCommand": "npm install"
}
```

### What Is Happening Step by Step

1. **`"image"`** — VS Code pulls this Docker image if it's not already cached
   locally, then starts a container from it. Everything else in the file
   configures that container.

2. **`"features"`** — After the container starts, VS Code runs the feature's
   install script inside it. The Docker-in-Docker feature installs the Docker
   CLI and daemon, then adjusts permissions so the non-root `node` user can
   run `docker` commands without `sudo`.

3. **`"customizations.vscode.extensions"`** — VS Code installs these
   extensions *inside the container*, not on your host. This is important:
   extensions that rely on language tooling (like ESLint) need to run where
   the code runs. If they were installed only on the host, they couldn't see
   the container's `node_modules`.

4. **`"forwardPorts"`** — VS Code creates a tunnel between `localhost:3000` on
   your host and port 3000 inside the container. Without this, a server
   binding to `0.0.0.0:3000` inside the container would be unreachable from
   your browser.

5. **`"postCreateCommand"`** — Runs `npm install` the first time the container
   is created. This means dependencies are ready the moment you open a
   terminal, without having to remember to run it yourself.

### What Would Break If You Removed `"forwardPorts"`?

Your NestJS server would start fine inside the container and bind to port
3000. But when you opened `localhost:3000` in your browser, the connection
would be refused — the port exists inside the container's network namespace,
not on your host. VS Code's port forwarding is the bridge between the two.
You can always add ports manually via the VS Code Ports panel, but declaring
them here means they're always forwarded automatically.

---

## Now Apply It

In the board game platform, the devcontainer will forward multiple ports as
services are added:

| Port | Service |
|------|---------|
| 3000 | NestJS API |
| 3001 | Next.js frontend |
| 5432 | PostgreSQL (dev only) |
| 8080 | Keycloak admin console |

Files to look at after this note:
- [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) — check
  the `forwardPorts` array and compare it to the services in `docker-compose.dev.yml`
- [.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) — look at
  which features are installed and why each one is needed

---

## Checkpoint Questions

1. What is the difference between installing a VS Code extension on your host
   machine versus declaring it in `devcontainer.json`? Why does it matter for
   ESLint?

2. If you add a new service on port 5432 in Docker Compose but forget to add
   `5432` to `forwardPorts`, what happens when you try to connect to it from
   your host machine?

3. What does `postCreateCommand` do, and when exactly does it run relative to
   the container's lifecycle?

4. Why did we choose Docker-in-Docker over mounting the host Docker socket?
   What is the security difference?

5. A teammate clones the repo, opens it in VS Code, and gets the prompt
   "Reopen in Container". They click it. Walk me through what VS Code does
   from that click to the moment the terminal is ready.

---

## Rewrite Exercise

`rewrite: true` for this topic.

Delete `.devcontainer/devcontainer.json` and recreate it from memory.
Use this note as a reference for concepts, but do not look at the generated
file.

Focus on: getting the `features` block right — the syntax is easy to forget
(`"feature-url": {}` not `"feature-url": true`) and the Docker-in-Docker
feature URL is not something you'd guess.

It is fine if your version differs — what matters is that you can explain
every key you write.

---

## Summary

Built: `.devcontainer/devcontainer.json` using the Microsoft Node 20 base image, Docker-in-Docker feature, ESLint/Prettier/Docker/Claude Code extensions, and `npm install` as `postCreateCommand`. No ports forwarded yet — deferred to when services are introduced.

Demonstrated understanding of: The bind-mount model (project files live on host, projected into container — not baked into the image); why `postCreateCommand` is the right place for `npm install` rather than a Dockerfile; the difference between system-level setup (Dockerfile) and project-level setup (postCreateCommand); and why extensions must run on the in-container VS Code server to access Node and node_modules. Successfully recreated the file from memory, including the correct `"feature-url": {}` syntax for the features block.

To revisit: None identified.
