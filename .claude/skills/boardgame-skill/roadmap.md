# Learning Roadmap

This file is the authoritative list of phases and topics. Claude Code reads
this to determine what comes next and what metadata applies to each topic.

Each topic has:
- `id` — used in progress.json and note filenames
- `rewrite` — if true, trigger the rewrite exercise after checkpoint
- `secops` — if true, apply additional SecOps commentary during generation
- `depends_on` — topic ids that should be complete before this one

---

## Phase 0 — Dev Environment

**Goal:** A fully reproducible development environment defined as code.
Nothing installed manually. Any developer (or a fresh machine) should be
able to open the repo and have a working environment in one command.

Topics:

- id: `0_repo_structure`
  label: Monorepo layout, .env strategy, git setup
  rewrite: false
  secops: false
  depends_on: []

- id: `0_devcontainer`
  label: devcontainer.json — base image, features, extensions, port forwarding
  rewrite: true
  secops: false
  depends_on: [0_repo_structure]

- id: `0_docker_compose_dev`
  label: Docker Compose for dev — services, volumes, networking, hot reload
  rewrite: true
  secops: false
  depends_on: [0_devcontainer]

- id: `0_dependabot`
  label: Dependabot setup — automated dependency CVE pull requests
  rewrite: false
  secops: true
  depends_on: [0_repo_structure]

---

## Phase 1 — Foundation

**Goal:** Solid understanding of the languages and protocols in use before
any framework code is written.

Topics:

- id: `1_typescript`
  label: TypeScript — types, interfaces, generics, decorators
  rewrite: false
  secops: false
  depends_on: [0_devcontainer]

- id: `1_postgresql`
  label: PostgreSQL basics — schema design, joins, foreign keys, constraints
  rewrite: false
  secops: false
  depends_on: [0_docker_compose_dev]

- id: `1_rest`
  label: REST fundamentals — HTTP verbs, status codes, request/response shape
  rewrite: false
  secops: false
  depends_on: [1_typescript]

---

## Phase 2 — Backend Core

**Goal:** A working NestJS API connected to PostgreSQL, with auth guards,
validation, tests, and the BGG integration — all understood line by line.

Topics:

- id: `2_nestjs_modules`
  label: NestJS architecture — modules, controllers, providers, dependency injection
  rewrite: true
  secops: false
  depends_on: [1_typescript, 1_rest]

- id: `2_typeorm_entities`
  label: TypeORM entities — decorators, column types, relations, migrations
  rewrite: true
  secops: false
  depends_on: [2_nestjs_modules, 1_postgresql]

- id: `2_guards_pipes`
  label: Guards and pipes — validation, transport-agnostic JWT auth guard
  rewrite: true
  secops: true
  depends_on: [2_nestjs_modules]

- id: `2_testing`
  label: Testing in NestJS — Jest unit tests, e2e tests, mocking providers
  rewrite: false
  secops: false
  depends_on: [2_nestjs_modules]

- id: `2_bgg_integration`
  label: BGG XML API2 — XML parsing, async polling, background jobs, caching
  rewrite: false
  secops: false
  depends_on: [2_nestjs_modules, 2_typeorm_entities]

- id: `2_owasp`
  label: OWASP Top 10 applied — broken access control, IDOR in group/review API
  rewrite: false
  secops: true
  depends_on: [2_guards_pipes]

- id: `2_audit_logging`
  label: Audit logging — Pino structured logs, audit_log table, sensitive event capture
  rewrite: false
  secops: true
  depends_on: [2_nestjs_modules, 2_typeorm_entities]

---

## Phase 3 — Frontend, Auth & Real-Time

**Goal:** A working Next.js PWA authenticated via Keycloak, with file
uploads, the invite system, scheduling, and — last of all — chat.

Topics:

- id: `3_nextjs`
  label: Next.js fundamentals — app router, server vs client components, API calls
  rewrite: false
  secops: false
  depends_on: [1_typescript]

- id: `3_keycloak`
  label: Keycloak integration — realm setup, client config, JWT flow end-to-end
  rewrite: true
  secops: true
  depends_on: [3_nextjs, 2_guards_pipes]

- id: `3_pwa`
  label: PWA setup — manifest, service worker, Android install, offline basics
  rewrite: false
  secops: false
  depends_on: [3_nextjs]

- id: `3_r2_uploads`
  label: Cloudflare R2 — S3 SDK, presigned URLs, multipart upload from NestJS
  rewrite: false
  secops: true
  depends_on: [2_nestjs_modules]

- id: `3_invite_system`
  label: Invite system — signed tokens, expiry, group roles, QR code generation
  rewrite: true
  secops: true
  depends_on: [3_keycloak, 2_typeorm_entities]

- id: `3_scheduling`
  label: Play session scheduling — proposals, RSVPs, iCal feed generation
  rewrite: false
  secops: false
  depends_on: [2_typeorm_entities, 2_nestjs_modules]

- id: `3_vault`
  label: HashiCorp Vault — setup, Vault Agent, secrets injection into containers
  rewrite: false
  secops: true
  depends_on: [0_docker_compose_dev, 3_keycloak]

- id: `3_websockets`
  label: Group chat — @nestjs/websockets, Socket.io, JWT validation on handshake
  rewrite: false
  secops: true
  depends_on: [3_keycloak, 2_guards_pipes]
  note: LOWEST PRIORITY — build this last

---

## Phase 4 — Cloud Infrastructure & Hardening

**Goal:** The application running on Oracle Cloud Free Tier, with a proper
CI/CD pipeline, network hardening, container security, and Vault in production.

Topics:

- id: `4_traefik`
  label: Traefik — reverse proxy, Let's Encrypt TLS, rate limiting, WSS, security headers
  rewrite: false
  secops: true
  depends_on: [0_docker_compose_dev]

- id: `4_terraform`
  label: Terraform — OCI resources, networking, Network Security Groups, state management
  rewrite: false
  secops: true
  depends_on: [0_repo_structure]

- id: `4_github_actions`
  label: GitHub Actions CI/CD — lint, test, npm audit, Trivy scan, SSH deploy
  rewrite: false
  secops: true
  depends_on: [2_testing, 4_terraform]

- id: `4_fail2ban`
  label: Fail2ban + SSH hardening — Ansible playbook, Keycloak ban rules, sshd_config
  rewrite: false
  secops: true
  depends_on: [4_traefik]

- id: `4_container_security`
  label: Container security — non-root users, read-only filesystems, Trivy, image pinning
  rewrite: false
  secops: true
  depends_on: [0_docker_compose_dev]

---

## Phase 5 — Operations & SecOps

**Goal:** The system observable, alertable, and with a written incident
response plan. Backups automated and tested.

Topics:

- id: `5_loki`
  label: Grafana Loki — log aggregation, NestJS + Keycloak log shipping, log-based alerts
  rewrite: false
  secops: true
  depends_on: [2_audit_logging]

- id: `5_prometheus_grafana`
  label: Prometheus + Grafana — metrics, dashboards, alert rules
  rewrite: false
  secops: false
  depends_on: [5_loki]

- id: `5_backups`
  label: Backup automation — pg_dump, compression, R2 storage, retention policy
  rewrite: false
  secops: false
  depends_on: [4_terraform]

- id: `5_incident_response`
  label: Incident response runbook — credential rotation, backup restore, anomaly triage
  rewrite: false
  secops: true
  depends_on: [5_loki, 5_prometheus_grafana, 5_backups]
