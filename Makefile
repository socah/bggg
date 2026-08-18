MODE_FILE := .claude/skills/active-mode.txt

# Three targets: mode-learning / mode-feature-dev write the mode file,
# mode-status reports the current mode (repairing it to "learning" if
# missing/invalid). $(MODE_FILE) is git-tracked, so switching modes is a
# working-tree change that is per-checkout/per-worktree — flipping the mode
# in one git worktree does not affect any other worktree or clone.
.DEFAULT_GOAL := mode-status

.PHONY: mode-learning mode-feature-dev mode-status deploy-dev deploy-prod seed-dev reset-dev apply-schema

mode-learning:
	@echo learning > $(MODE_FILE)
	@echo "Active mode set to: learning"

mode-feature-dev:
	@echo feature-dev > $(MODE_FILE)
	@echo "Active mode set to: feature-dev"

mode-status:
	@MODE=$$(cat $(MODE_FILE) 2>/dev/null); \
	if [ "$$MODE" = "learning" ] || [ "$$MODE" = "feature-dev" ]; then \
		echo "Active mode: $$MODE"; \
	else \
		echo learning > $(MODE_FILE); \
		echo "Active mode: learning (default, mode file was missing or invalid)"; \
	fi

# Local stack only — '.env's COMPOSE_FILE (docker-compose.yml:docker-compose.dev.yml)
# already tells plain 'docker compose' which override file to merge in, so no
# '-f'/'--env-file' flags are needed here the way deploy-prod below needs both.
deploy-dev:
	docker compose up -d --build

# Creates the one bootstrap login (BOOTSTRAP_ADMIN_EMAIL/PASSWORD in .env)
# that dev needs to log in at all — registration is invite-only, so there's
# no other way to get a first account. Safe to re-run: seed-admin.ts treats
# "already exists" as a no-op, not an error. Run after 'make deploy-dev'
# once Keycloak is up.
#
# '.env' is only ever read by 'docker compose' itself (for container
# variable substitution) — nothing loads it into the host shell, so
# seed-admin.ts's plain process.env.BOOTSTRAP_ADMIN_* reads would otherwise
# always be empty here. 'set -a' exports every variable sourcing '.env'
# defines, for this recipe's shell only.
#
# KEYCLOAK_URL is overridden afterward on purpose: '.env's value
# (http://keycloak:8080) is the Docker-network hostname, correct for
# containers talking to each other — but seed-admin.ts runs on the host via
# ts-node, never inside a container (same container-name-vs-localhost split
# documented on KEYCLOAK_URL in .env.example itself), so it needs
# localhost, not the in-network name.
seed-dev:
	@set -a && . ./.env && set +a && KEYCLOAK_URL=http://localhost:8080 npm run seed:admin --workspace=apps/api

# Applies db/schema.sql — this file is a hand-maintained reference, not a
# real migration (see its own header: synchronize is false in
# app.module.ts and there is no migrations directory yet), so nothing
# creates these tables automatically. 'CREATE TABLE IF NOT EXISTS'
# throughout that file makes this safe to run against an already-schema'd
# database, so it runs on every reset-dev, not just a first-ever one.
# Waits on Postgres directly (pg_isready) rather than 'docker compose up
# --wait', since 'db' has no healthcheck of its own to wait on — its
# depends_on only waits for vault-agent to render the password file, not
# for Postgres itself to finish starting up and accept connections.
apply-schema:
	@set -a && . ./.env && set +a && n=0; until docker compose exec -T db pg_isready -U "$$DB_USER" >/dev/null 2>&1; do \
		n=$$((n+1)); \
		if [ $$n -ge 30 ]; then \
			echo "Database did not become ready within 1 minute — check 'docker compose logs db'."; \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@set -a && . ./.env && set +a && docker compose exec -T db psql -U "$$DB_USER" -d "$$DB_NAME" -f /dev/stdin < db/schema.sql

# Full reset for local dev: tears down whatever's currently running, brings
# the stack back up from scratch, then seeds the bootstrap login. Separate
# from 'deploy-dev' (which stays non-destructive) because 'down' discards
# any in-progress container state — the right hammer for "the stack is in
# a broken/half-started state, start over," not the everyday command.
#
# No healthcheck exists for 'keycloak' (see docker-compose.yml), so
# 'docker compose up --wait' can't tell us when it's actually ready to
# serve the realm — 'api'/'web' only wait on 'vault-agent', not on
# Keycloak itself. Polling its own realm discovery endpoint is the same
# "wait for the real condition, not a guessed sleep" approach
# vault-bootstrap's own comments describe; bounded at 2 minutes so a
# genuinely broken Keycloak fails loudly instead of hanging forever.
#
# Keycloak has no persistent volume in dev — 'down' + up always
# re-imports the realm and regenerates the 'api-service'/'web' client
# secrets, so whatever was in .env before this run is now stale. Fetching
# them fresh every time (not just once) is what makes this actually a
# single command instead of "run this, then go paste two secrets from the
# admin console, then run the rest." 'api'/'web' already started against
# the (stale-or-blank) old secret values as part of deploy-dev above — restarting
# them is what makes the freshly-written .env values actually take effect;
# 'docker compose up' recreates a container automatically when the
# resolved env vars driving it change, so this doesn't need '--build'.
#
# This only recreates the CONTAINERIZED 'api'/'web'. If you're running the
# host-based hot-reload workflow instead ('npm run dev:api' / 'dev:web'),
# those are long-running processes in your own terminal — a Makefile
# recipe has no business killing a foreground process out from under you,
# so it can't restart them for you. What it CAN do is notice they're
# running (something bound to port 3000/3001) and say so, since this
# reset just regenerated the secrets and DB state those already-running
# processes are silently still holding stale copies of — reproduced
# directly: this exact staleness caused a real 500 mid-session.
reset-dev:
	docker compose down
	$(MAKE) deploy-dev
	$(MAKE) apply-schema
	@echo "Waiting for Keycloak to be ready..."
	@n=0; until curl -sf http://localhost:8080/realms/boardgame/.well-known/openid-configuration >/dev/null 2>&1; do \
		n=$$((n+1)); \
		if [ $$n -ge 60 ]; then \
			echo "Keycloak did not become ready within 2 minutes — check 'docker compose logs keycloak'."; \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Keycloak is ready."
	infra/scripts/fetch-keycloak-dev-secrets.sh
	docker compose up -d api web
	$(MAKE) seed-dev
	@if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -qE ':3000 |:3001 '; then \
		echo ""; \
		echo "⚠  'npm run dev:api' and/or 'dev:web' look like they're still running"; \
		echo "   (something is bound to port 3000/3001). This reset just regenerated"; \
		echo "   Keycloak's client secrets and recreated the database — those already-"; \
		echo "   running processes are holding stale copies of both and won't notice"; \
		echo "   on their own. Stop and restart them now."; \
	fi

# Same command a developer would run by hand, and the exact one
# .github/workflows/ci.yml's 'deploy' job runs on every push to main —
# infra/ansible/deploy.sh owns the real secret-import/Terraform/ansible-playbook
# logic so there's one definition of "how to deploy prod", not a second one
# duplicated here. Extra ansible-playbook args (e.g. '-e app_deploy_source=local')
# can still be passed through: 'make deploy-prod ARGS="-e app_deploy_source=local"'.
deploy-prod:
	infra/ansible/deploy.sh $(ARGS)
