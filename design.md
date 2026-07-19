# Board Game Group Platform

## Project Goal

Build a self-hosted board game collection, review, and play-tracking platform for a gaming group.

The project serves two purposes:

1. Solve a real-world problem: managing and reviewing the group's board game collection.
2. Learn modern software engineering, infrastructure, DevOps, deployment, and SecOps practices.

The system should be deployable both on Oracle Cloud Free Tier and on a home server with minimal changes.

---

# Core Features

## Game Collection

Games can be added to the platform in two ways: by linking a BGG account and syncing the collection, or by manually adding a game using its BGG ID.

### Adding Games

**BGG Account Sync**

Users can link their BGG username (stored on their profile — no OAuth required, the BGG API is public). Once linked, they can trigger a collection sync at any time.

Sync flow:

```text
User triggers sync
  ↓
NestJS calls BGG XML API2 (collection endpoint)
  ↓
BGG returns 202 Accepted for large collections → NestJS polls until ready
  ↓
For each game in collection:
  - Game already in DB (matched by BGG ID) → add ownership record only
  - Game not in DB → create game record, then add ownership record
  ↓
Return summary (X new games added, Y already existed)
```

**Manual Add by BGG ID**

Users can enter a BGG game ID directly. NestJS fetches the game data from the BGG API, presents a confirmation screen, and saves it on confirmation. Also supports search by game name via the BGG search endpoint.

### Game Catalogue Design

The game catalogue is shared across all users and groups. A game record is created once (keyed by BGG ID) and reused when multiple users own the same game. Ownership is tracked separately via a join table.

This ensures reviews and ratings are unified per game regardless of who imported it.

### Data Stored per Game

* BGG ID
* Name
* Year
* Image (BGG CDN URL)
* Player counts
* Play time
* BGG rating
* BGG weight (complexity)
* Description
* Last synced timestamp

### BGG API Notes

The BGG XML API2 is public with no authentication or API key required. It can be slow and occasionally returns `202 Accepted` for large requests, requiring polling. Game data should be cached in the local database — do not call BGG on every page load. Syncs run as background jobs via `@nestjs/schedule`.

### Tracked per User/Group

* Which users own each game
* Tags and categories
* Collection statistics

---

## Reviews

Each user can create and edit a single review per game.

Review fields:

* Rating (1-10)
* Complexity score (1-5)
* Depth score (1-5)
* Written review

Requirements:

* Reviews must be editable
* Aggregate scores displayed per game
* Review history optional future enhancement

---

## Comments

Discussion thread per game.

Users can:

* Add comments
* Edit their own comments
* Delete their own comments

---

## Play Sessions

Track:

* Date played
* Players
* Winner
* Duration
* Notes
* Photos (user-uploaded, stored in Cloudflare R2)

Future analytics:

* Most played games
* Recent plays
* Player statistics

---

## Play Session Scheduling

Propose and coordinate future game nights within a group.

A scheduled session is a separate concept from a recorded play session. A proposal may or may not result in a played game — it tracks intent and coordination, not outcome.

Proposal fields:

* Proposed game (optional — open game nights are allowed)
* Date and time
* Location or notes
* Status (open, confirmed, cancelled)

RSVP system:

* Members respond yes, no, or maybe
* Group admins can confirm or cancel the proposal

Conversion flow:

```text
Proposal confirmed and played
  ↓
Admin creates play session record from the proposal
  ↓
play_sessions.proposal_id links back to the original proposal
```

iCal feed:

* Each group exposes a public iCal URL (`.ics`)
* Members can subscribe in Google Calendar, Apple Calendar, or any calendar app
* No OAuth or external API required — a simple NestJS endpoint generating standard iCal format

Push notifications (future, see Push Notifications):

* New proposal created
* RSVP reminder before the session
* Proposal confirmed or cancelled

---

## Statistics

Provide:

* Average group rating
* Average complexity
* Average depth
* Most played games
* Highest rated games
* Recently played games

---

# Technology Stack

## Frontend

Next.js Progressive Web App (PWA)

Reasons:

* Single codebase for web and Android (via PWA install)
* TypeScript — consistent language across the full stack
* Installable on Android home screen, runs fullscreen
* Camera access supported (for QR code scanning)
* Can be wrapped with Capacitor in the future if native APK distribution is needed
* Simpler build and deployment pipeline than Flutter

Primary target:

* Android (installed as PWA)

Secondary target:

* Web browser

---

## Backend

NestJS

Responsibilities:

* REST API
* JWT validation (tokens issued by Keycloak)
* Business logic
* Validation
* Presigned upload URL generation for Cloudflare R2 (file bytes go client → R2 directly, not through NestJS)
* BGG API integration (game lookup, collection sync)
* Background jobs (collection sync via `@nestjs/schedule`)
* iCal feed generation (play session scheduling)
* WebSocket gateway (group chat — lowest priority feature)

---

## Authentication

Keycloak

Responsibilities:

* User identity and credential management
* Email/password login (Phase 1)
* Google OAuth (Phase 2 — add provider in Keycloak admin, no backend code changes)
* JWT issuance and signing
* User registration flow

NestJS validates Keycloak-issued JWTs but does not manage credentials directly.

Group membership, roles, and invitations are managed in the application database, not in Keycloak.

---

## Database

PostgreSQL

Stores:

* Users (linked to Keycloak user IDs, optional BGG username)
* Groups and group membership
* Group invitations
* Games (shared catalogue, keyed by BGG ID)
* Game ownership (per user)
* Reviews
* Comments
* Play sessions (with optional link to originating proposal)
* Play session photos (URLs only; binaries in Cloudflare R2)
* Play session proposals and RSVPs
* Chat messages (lowest priority)
* Audit log

---

## File Storage

Cloudflare R2

Used for:

* User-uploaded play session photos

Reasons:

* S3-compatible API
* Free tier: 10 GB storage, 1 million requests/month
* No egress fees
* Sufficient for a small gaming group

Cover art is served directly from BGG CDN URLs — no local storage needed.

Upload flow (presigned URL — NestJS never touches file bytes):

```text
Client                          NestJS                        Cloudflare R2
  |--- POST /uploads/presign --->|                                  |
  |                              | (generates object key,           |
  |                              |  signs a short-lived PUT URL)    |
  |<-- { url, key } -------------|                                  |
  |------------------------------ PUT file (direct) --------------->|
  |--- POST /uploads/confirm --->|                                  |
  |     { key }                  | (persists key/URL in PostgreSQL) |
```

Object key is always generated server-side (never client-supplied) and the
signature is scoped to one key, one content-type, one exact size, and a
short expiry window (minutes) — see `notes/3_r2_uploads.md` for the full
rationale.

Limits enforced (both configurable via env, defaults shown):

* Per-file size: 10 MiB (`MAX_UPLOAD_BYTES`), pinned into the presigned
  URL's signature so R2 itself rejects a PUT of the wrong size
* Total bucket storage: 10 GiB (`R2_MAX_STORAGE_BYTES`), matching the free
  tier — checked (approximately; not an atomic reservation) against the sum
  of confirmed photos' real sizes before a new presign URL is issued

---

## Secrets Management

HashiCorp Vault

Used for:

* Storing all application secrets (database credentials, Keycloak client secrets, R2 keys, JWT signing keys)
* Dynamic secret generation and leasing
* Secret rotation without application redeployment
* Replacing plain `.env` files for sensitive values in all environments

Vault Agent injects secrets into containers at runtime — secrets never touch disk or appear in environment variable listings.

Runs as a Docker service alongside the application in both development and production.

---

## Audit Logging

Structured application-level audit log capturing security-relevant events.

Logged events:

* Authentication events (login, failed login, token refresh, logout)
* Admin actions (invite creation, member kick, role elevation)
* Data mutations (review edits, session deletions, group changes)
* Keycloak-generated auth events (shipped to the same log aggregator)

Implementation:

* Structured JSON logging via Pino in NestJS
* Audit events written to the `audit_log` PostgreSQL table for queryable history
* Log stream shipped to Grafana Loki for aggregation, search, and alerting

---

# Data Model

## Groups and Invitations

```text
groups
  id, name, created_by, created_at

group_members
  group_id, user_id, role (admin | member), joined_at

invites
  id, group_id, token (signed), created_by, expires_at, used_at
```

## Users

```text
users
  id (Keycloak user ID), bgg_username (nullable), created_at
```

The `bgg_username` field enables collection sync. It is optional — users without a BGG account can still add games manually.

## Games and Ownership

```text
games
  id, bgg_id (unique), name, year, image_url, min_players, max_players,
  min_playtime, max_playtime, bgg_rating, bgg_weight, description,
  last_synced_at, created_at

game_ownership
  game_id, user_id, added_at
```

## Invite Flow

```text
Group admin generates invite link or QR code
  ↓
https://yourapp.com/join?token=<signed_token>
  ↓
New user clicks link → redirected to Keycloak to register
  ↓
After registration → backend validates token
  ↓
User added to group with member role
```

Group admins can:

* Invite new members (URL or QR code)
* Accept or reject pending invitations
* Kick members
* Elevate members to admin role

## Play Sessions

The `proposal_id` foreign key is nullable — sessions can be recorded without a prior proposal. When a proposal is converted to a session, the link is preserved for historical context.

```text
play_sessions
  id, group_id, game_id, played_at, duration, winner_user_id,
  notes, proposal_id (nullable FK → play_session_proposals), created_at

play_photos
  id, session_id, uploaded_by, url, created_at
```

## Play Session Scheduling

```text
play_session_proposals
  id, group_id, proposed_by, game_id (nullable), scheduled_for,
  location, notes, status (open | confirmed | cancelled), created_at

proposal_rsvps
  proposal_id, user_id, response (yes | no | maybe), responded_at
```

## Audit Log

```text
audit_log
  id, user_id, action, entity_type, entity_id, metadata (jsonb), ip_address, created_at
```

Actions include: `user.login`, `user.login_failed`, `group.invite_created`, `group.member_kicked`,
`group.role_changed`, `review.edited`, `session.deleted`, and similar.

## Group Chat (lowest priority)

Chat is scoped to a group. Messages are delivered over WebSockets. The NestJS JWT auth guard must be extended to validate tokens on the WebSocket handshake — keep token validation logic transport-agnostic from the start to make this straightforward.

```text
chat_messages
  id, group_id, user_id, content, created_at, edited_at (nullable)

chat_message_reads (optional — for read receipts)
  message_id, user_id, read_at
```

---

# Architecture

```text
Next.js PWA (Browser / Android)
     |
     | HTTPS / WSS (WebSocket, for chat)
     v
Traefik Reverse Proxy
     |
     ├──> Keycloak (auth)
     |
     ├──> NestJS API
     |         |
     |         └──> PostgreSQL
     |         |
     |         └──> Cloudflare R2 (file storage)
```

All services run in Docker containers except Cloudflare R2 (external managed service).

WebSocket connections for group chat are handled by the same NestJS process via `@nestjs/websockets`. No separate service is needed at this scale. Traefik forwards WebSocket upgrades transparently.

---

# Deployment Strategy

## Local Development

Dev Container (`.devcontainer`)

The development environment is fully defined as code using a `.devcontainer` folder, compatible with VS Code Dev Containers and GitHub Codespaces.

The dev container provides:

* Consistent, reproducible environment across all developer machines
* All required tooling pre-installed (Node.js, NestJS CLI, Docker CLI, Terraform, Ansible)
* VS Code extensions defined in code
* No "works on my machine" issues

Internal services are managed with Docker Compose from within the dev container:

```text
Developer Machine
└── Dev Container
      └── Docker Compose
            ├── PostgreSQL
            ├── NestJS
            ├── Keycloak
            ├── Vault
            └── Traefik
```

---

## Oracle Cloud Deployment

Target platform:

* Oracle Cloud Free Tier

Infrastructure:

```text
Oracle VM
├── Traefik
├── Vault
├── Keycloak
├── NestJS
├── PostgreSQL
├── Grafana (future)
├── Prometheus (future)
└── Loki (future)
```

Benefits:

* Free hosting
* Public deployment
* Terraform support
* Good learning environment

---

## Home Server Deployment

Target hardware:

* Mini PC
* Intel NUC
* Raspberry Pi
* Old desktop

Infrastructure identical to cloud deployment.

Only infrastructure configuration changes.

Application remains unchanged.

---

# Infrastructure as Code

## Terraform

Used for:

* Oracle Cloud resources
* Networking
* Firewall rules
* Public IPs
* Cloudflare R2 bucket (object storage)
* Cloud infrastructure provisioning

Terraform should NOT manage application deployment.

DNS is handled by DuckDNS instead of a Terraform-managed record — a systemd
timer (installed by Ansible) runs on the VM itself and periodically updates
DuckDNS with the VM's current IP, so DNS stays correct even if the IP
changes without anyone running `terraform apply`.

Application deployment remains container-based.

---

## Ansible

Used for:

* Server configuration
* Docker installation
* Traefik installation
* System setup
* Environment configuration
* SSH hardening (key-based auth, disabled password login)
* Fail2ban installation and configuration
* Unattended security upgrades for OS packages

Flow:

```text
Terraform
    ↓
Ansible
    ↓
Docker Compose
    ↓
Application
```

---

# Containerization

Docker Compose orchestrates:

```text
services:
  - traefik
  - vault
  - keycloak
  - backend
  - postgres
```

Future:

```text
  - grafana
  - prometheus
  - loki
```

---

# CI/CD

GitHub Actions

Pipeline:

1. Lint
2. Test
3. `npm audit` — fail on high-severity vulnerabilities
4. Trivy image scan — fail on critical CVEs
5. Build Docker images
6. Deploy to target environment

Deployment method:

```text
GitHub Actions
       ↓
SSH
       ↓
Target Server
       ↓
docker compose pull
docker compose up -d
```

Same pipeline for:

* Oracle Cloud
* Home server

---

# Monitoring and Observability

Future phases.

## Metrics

Tools: Prometheus + Grafana

Metrics:

* CPU and memory
* Response times and error rates
* Database performance
* Active WebSocket connections

## Logs

Tool: Grafana Loki

Log sources:

* NestJS structured JSON logs (via Pino)
* Keycloak authentication events
* Traefik access logs
* PostgreSQL slow query logs

## Alerting

Grafana alerts on:

* High error rates
* Repeated authentication failures (potential brute force)
* Unusual admin actions
* Disk usage thresholds (backup volume)
* Container restarts

---

# Security

## Authentication

Phase 1:

* Email/password via Keycloak

Phase 2:

* Google OAuth via Keycloak (provider configuration only, no code changes)

## Application Security Requirements

* HTTPS everywhere
* JWT validation in NestJS (tokens issued by Keycloak)
* Passwords managed by Keycloak (hashing, storage, reset flows)
* Signed invite tokens with expiry
* JWT validation extended to WebSocket handshake (for chat) — token validation logic must remain transport-agnostic from the start
* iCal feed URLs are group-scoped and may include a token to prevent enumeration
* OWASP Top 10 awareness applied during API development — particularly broken access control and insecure direct object references, which are relevant to the group membership and review ownership models

## Secrets Management

* All secrets stored in HashiCorp Vault — no plaintext secrets in `.env` files, Docker Compose files, or CI/CD environment variables
* Vault Agent injects secrets into containers at runtime
* Secret rotation policy defined for database credentials and API keys
* Dependabot enabled on the GitHub repository — automated PRs for dependency CVEs

## Container Security

* All containers run as non-root users
* Read-only filesystems where applicable
* Trivy scans all Docker images in CI — build fails on critical CVEs
* Docker socket access restricted — not exposed to application containers
* Images pinned to specific digest tags in production, not floating `latest`

## Network Security

* Traefik rate limiting middleware on all API routes — protects against brute force and abuse
* Traefik security headers on all responses: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`
* Fail2ban on the host — bans IPs after repeated Keycloak authentication failures
* SSH hardening via Ansible: key-based auth only, password auth disabled, non-default port
* Oracle Cloud Network Security Groups configured via Terraform — only ports 80, 443, and SSH exposed; all other inbound traffic blocked

## Audit and Observability

* Structured audit logging in NestJS via Pino — all security-relevant events logged as JSON
* Audit events persisted to `audit_log` table in PostgreSQL for queryable history
* Keycloak auth events enabled and shipped to Grafana Loki
* Log-based alerts in Grafana for repeated login failures, unusual admin actions, and error rate spikes
* Incident response runbook maintained in the repository — covers credential rotation, backup restoration, and anomalous traffic response

---

# Backups

Daily PostgreSQL backups.

Goals:

* Easy migration between environments
* Disaster recovery
* Data portability

Backup strategy:

```text
pg_dump
    ↓
Compressed Backup
    ↓
Retention Policy
```

Note: Cloudflare R2 data (play photos) should be included in backup considerations. R2 supports lifecycle policies and versioning.

---

# Development Goals

This project is intentionally used to learn:

## Application Development

* Next.js (PWA)
* NestJS
* PostgreSQL
* REST APIs
* Keycloak integration
* BGG XML API2 integration
* Background job scheduling
* iCal feed generation
* WebSocket real-time communication (group chat)

## DevOps

* Docker
* Dev Containers
* CI/CD
* GitHub Actions

## Infrastructure

* Terraform
* Ansible
* Reverse proxies
* TLS certificates

## Operations

* Monitoring
* Logging
* Backups
* Object storage (Cloudflare R2)

## SecOps

* Secrets management (HashiCorp Vault)
* Container security (non-root, Trivy scanning)
* Network hardening (Traefik rate limiting, security headers, Fail2ban)
* Dependency scanning (npm audit, Dependabot)
* Structured audit logging (Pino, Loki)
* OWASP Top 10 applied to API design
* Incident response planning

---

# Future Enhancements

## Native Android App

If PWA limitations are encountered, wrap the existing Next.js app using Capacitor to produce a distributable APK without rewriting the frontend.

---

## BoardGameGeek Integration (Phase 2)

Automatic periodic re-sync of linked BGG collections on a schedule, without requiring manual user-triggered syncs.

---

## Recommendation Engine

Recommend games based on:

* Ratings
* Complexity preferences
* Play history

---

## Push Notifications

Notify users of:

* New comments
* New reviews
* New play session proposal
* RSVP reminder before a scheduled session
* Proposal confirmed or cancelled
* New chat messages (lowest priority)

---

## Advanced Analytics

* Rating trends
* Most played games
* Hidden gems
* Group preferences

---

# Guiding Principle

Keep the application portable.

The same codebase should run on:

* Local Docker environment (via Dev Container)
* Oracle Cloud Free Tier
* Home server

Infrastructure should be reproducible through:

* Terraform
* Ansible
* Docker Compose
* Dev Containers (`.devcontainer`)

The project should remain free to operate while providing hands-on experience with modern software engineering and DevOps practices.
