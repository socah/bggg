# Dependabot — Automated Dependency CVE Pull Requests

**Phase:** 0 — Dev Environment
**Topic ID:** 0_dependabot
**Date:** 2026-06-22
**SecOps:** Yes

---

## What Is This?

**Dependabot** is a GitHub service that watches your repository for dependencies
with known security vulnerabilities (CVEs) and automatically opens pull requests
to update them. You configure it once in `.github/dependabot.yml` and it runs
on a schedule — checking your `package.json` lockfiles, Docker base images, and
other package ecosystems.

A **CVE** (Common Vulnerabilities and Exposures) is a public record of a known
security flaw in a piece of software. The npm advisory database, Docker Hub, and
the National Vulnerability Database (NVD) all track these. When a CVE is
published for a package your project depends on, Dependabot opens a PR that day.

---

## Why Does It Matter for This Project?

When you run `npm install express`, you get Express — but Express has its own
dependencies, which have their own dependencies. The full tree for a NestJS
project can exceed 500 packages. You wrote maybe 20 of those. The other 480+
come from npm authors you have never met, and any one of them can ship a
version with a security flaw. Dependabot automates the work of watching that
entire tree so you don't have to.

For this project specifically: the platform handles group invites (signed
tokens), user authentication (Keycloak JWTs), and file uploads (R2). A
compromised dependency in the auth or file-handling path could expose user
data. Supply chain attacks — where a malicious actor publishes a vulnerable
or backdoored version of a popular package — are not theoretical; they happen
multiple times per year at scale.

---

## The Decision

**Chose:** Configure Dependabot for both the `npm` ecosystem and the `docker`
ecosystem from Phase 0.

**Because:** The sooner it is set up, the more CVEs it catches before they
accumulate. Adding it later means a backlog of stale dependencies to triage
at once. The `docker` ecosystem scans the base images in `docker-compose.dev.yml`
and any Dockerfiles — important because OS-level vulnerabilities (in Alpine
packages, for example) are separate from npm vulnerabilities.

**Alternative:** Rely on running `npm audit` manually before each release.

**Drawback of alternative:** Manual processes get skipped under deadline
pressure. `npm audit` also only runs when you remember to; Dependabot runs
whether you remember or not.

---

## SecOps Notes

**Security property upheld:** Software supply chain integrity. Your
application's security surface is not just your code — it includes every
package in `node_modules` and every layer in your base Docker images.

**Attack mitigated:** Supply chain compromise. An attacker who publishes a
backdoored version of a transitive dependency (a package your packages depend
on, not one you installed directly) can achieve remote code execution in your
application without ever touching your code. This is not hypothetical: the
`event-stream` attack (2018) and the `ua-parser-js` attack (2021) both used
this vector. Dependabot does not prevent the attack from being published, but
it surfaces the CVE to you immediately so you can update before deploying the
vulnerable version.

**What goes wrong without it:** A critical vulnerability is published in a
transitive dependency. You don't notice. You deploy. Months later an attacker
uses it. By then the fix has existed for months — the failure was not checking.

**Three tools, three layers** (only Dependabot is set up now; the others
come in Phase 4 with GitHub Actions CI):

| Tool | When it runs | What it scans |
|------|-------------|--------------|
| Dependabot | Scheduled (daily/weekly) | `package-lock.json`, Docker images |
| `npm audit` | CI pipeline, before build | Lockfile against npm advisory DB |
| Trivy | CI pipeline, after build | Docker image layers (OS + npm) |

Together they cover: known CVEs at development time (Dependabot), at every
push (npm audit), and in the final built image before it ships (Trivy).

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A Node.js project with a backend (`apps/api`) and a frontend (`apps/web`) on
GitHub. You want Dependabot to open PRs automatically for both npm and Docker.

### .github/dependabot.yml

```yaml
version: 2

updates:

  # Watches apps/api/package-lock.json
  - package-ecosystem: "npm"
    directory: "/apps/api"
    schedule:
      interval: "weekly"    # opens PRs every Monday
    # Group all non-security patch updates into one PR to reduce noise.
    # Security updates always get their own PR regardless of grouping.
    groups:
      non-security-patches:
        update-types: ["patch"]
        dependency-type: "production"

  # Watches apps/web/package-lock.json
  - package-ecosystem: "npm"
    directory: "/apps/web"
    schedule:
      interval: "weekly"

  # Watches FROM lines in any Dockerfile and image: lines in Compose files
  - package-ecosystem: "docker"
    directory: "/"            # scans the repo root and subdirectories
    schedule:
      interval: "weekly"
```

### What Is Happening Step by Step

1. **`version: 2`** — the Dependabot config schema version. Always 2 for
   current GitHub Dependabot. Required; the file is rejected without it.

2. **`package-ecosystem: "npm"`** — tells Dependabot to look for a
   `package-lock.json` or `yarn.lock` in the specified `directory`. Each app
   needs its own entry if they are in separate directories.

3. **`directory`** — the path within the repository where the lockfile lives.
   Always relative to the repo root. `/apps/api` means
   `<repo-root>/apps/api/package-lock.json`.

4. **`schedule.interval: "weekly"`** — Dependabot checks for new CVEs and
   version updates once per week. `"daily"` is available but creates more PR
   noise. Security advisories trigger PRs immediately regardless of this
   schedule.

5. **`groups`** — without grouping, a weekly npm update could open 30 separate
   PRs (one per outdated package). Groups merge routine patch updates into one
   PR, keeping the signal-to-noise ratio manageable. Security updates bypass
   groups and always get individual PRs.

6. **`package-ecosystem: "docker"`** — scans `FROM` instructions in Dockerfiles
   and `image:` lines in Compose files. When `postgres:16-alpine` gets a patch
   (`16.3-alpine` → `16.4-alpine`), Dependabot opens a PR to update the tag.

### What Would Break If You Omitted the `docker` Ecosystem Entry?

Dependabot would still catch npm CVEs, but OS-level vulnerabilities in your
Docker base images would go unnoticed. A CVE in the Alpine `musl` library
or an OpenSSL patch in the Postgres image would never surface in a PR — you
would only find it if Trivy scans it in CI, or never. Most developers think
about npm vulnerabilities and forget that their base images are also software.

---

## Now Apply It

In the board game platform, `.github/dependabot.yml` starts with three
entries (npm for `apps/api`, npm for `apps/web`, and docker for the root).
Both `apps/` directories are empty now but the entries are valid — Dependabot
silently skips a directory when no lockfile exists yet, then starts scanning
as soon as one appears.

Files to look at after this note:
- [.github/dependabot.yml](.github/dependabot.yml) — verify the three
  `package-ecosystem` entries and their directories
- [docker-compose.dev.yml](docker-compose.dev.yml) — this is what the `docker`
  entry will scan (`image: postgres:16-alpine`)

---

## Checkpoint Questions

1. What is the difference between what Dependabot does and what `npm audit`
   does? Could you use just one of them and skip the other?

2. You add a new npm package to `apps/api`. Three months later, a CVE is
   published for it. Walk me through what happens — how do you find out, and
   what does Dependabot produce?

3. Why is the `docker` ecosystem entry important even though your Docker images
   are not npm packages?

4. What is a transitive dependency, and why does it matter for supply chain
   security? Give a concrete example of how one could introduce a vulnerability
   without you installing it directly.

5. Dependabot opens a PR that bumps `express` from `4.18.2` to `4.18.3`. The
   PR is labeled `security`. What do you do — merge immediately, review the
   diff first, or ignore it? Why?

---

## Summary

Built: `.github/dependabot.yml` with four entries — npm for `apps/api`, npm for `apps/web`, docker for Compose/Dockerfile image tags, and devcontainers for `.devcontainer/devcontainer.json` (covering both the base image and features). Both npm entries are valid before lockfiles exist — Dependabot silently skips until they appear.

Demonstrated understanding of: Transitive dependencies and why they matter for supply chain security (less scrutinised than direct deps, deeper in the tree, but fully in node_modules). Correctly identified that the devcontainer image requires its own `devcontainers` ecosystem entry, not covered by the `docker` entry. Understood that grouped PRs reduce noise while security advisories always get individual PRs.

To revisit: None identified.
