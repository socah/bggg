# Local stack only — '.env's COMPOSE_FILE (docker-compose.yml:docker-compose.dev.yml)
# already tells plain 'docker compose' which override file to merge in, so no
# '-f'/'--env-file' flags are needed here the way deploy-prod below needs both.
.DEFAULT_GOAL := help
.PHONY: help deploy-dev deploy-prod dev-setup seed-user sync-secrets db-migrate dev-up dev-stop dev-status devcontainer-up devcontainer-run deploy-dev-with-user

help:
	@echo "Available targets: deploy-dev deploy-prod dev-setup dev-stop dev-status seed-user sync-secrets db-migrate devcontainer-up devcontainer-run deploy-dev-with-user"

# Devcontainer-friendly flow: keep app servers outside Docker so VS Code's
# forwarded ports map directly to host-browser URLs.
devcontainer-up:
	@if ! command -v infisical >/dev/null 2>&1; then \
		echo "infisical CLI not found — install it before running devcontainer-up" >&2; \
		exit 1; \
	fi
	@BGG_API_TOKEN=$$(infisical secrets get BGG_API_TOKEN --path=/ENV_VARS --env="$${INFISICAL_ENV:-dev}" --plain) || { \
		echo "Could not read BGG_API_TOKEN from Infisical" >&2; exit 1; \
	}; \
	sed -i '/^BGG_API_TOKEN=/d' .env; \
	printf 'BGG_API_TOKEN=%s\n' "$$BGG_API_TOKEN" >> .env
	docker compose up -d db keycloak
	infra/scripts/fetch-keycloak-dev-secrets.sh
	set -a && . ./.env && set +a && \
	KEYCLOAK_URL="http://localhost:8080" \
	BOOTSTRAP_ADMIN_EMAIL="$${DEV_SEED_USER_EMAIL}" \
	BOOTSTRAP_ADMIN_PASSWORD="$${DEV_SEED_USER_PASSWORD}" \
	npm run seed:admin --workspace=apps/api
	@echo "Next steps:"
	@echo "  Terminal 1: npm run dev:api"
	@echo "  Terminal 2: npm run dev:web"
	@echo "  Open forwarded port 3000 in your host browser."
	@echo "  Keycloak is on forwarded port 8080."

# One-command local run for devcontainers: setup infra, then start both app
# dev servers in this terminal. Ctrl+C stops both child processes.
devcontainer-run: devcontainer-up
	@echo "Starting dev:api and dev:web (Ctrl+C to stop both)..."
	@bash -lc 'set -euo pipefail; \
	npm run dev:api & API_PID=$$!; \
	npm run dev:web & WEB_PID=$$!; \
	trap "kill $$API_PID $$WEB_PID" INT TERM EXIT; \
	wait'

deploy-dev:
	docker compose up -d --build

# One-command local setup: bring the whole dev stack up (db, keycloak, vault),
# seed the throwaway login (username 'user', password 'user'), sync the
# Keycloak client secrets into .env, and start the api/web dev servers in the
# background — from a fresh clone to a working http://localhost:3000 with no
# admin-console steps. Servers run from your checkout via npm (the Docker
# web/api containers publish no host ports in dev by design); watch them in
# logs/api.log and logs/web.log. Migrations run before the servers start —
# the API never alters its own schema (synchronize: false), so a fresh
# database without this step makes every DB-backed page fail.
dev-setup: deploy-dev seed-user sync-secrets db-migrate dev-up

# Creates or password-resets the dev-only user via kcadm.sh inside the
# running keycloak container (infra/keycloak/seed-dev-user.sh). Safe to
# re-run any time — it waits for Keycloak to accept admin logins first.
seed-user:
	docker compose exec -T keycloak /bin/sh /seed-dev-user.sh

# Pulls the realm-generated client secrets ('web', 'api-service') into .env,
# so the OIDC login works without a manual admin-console copy step. Also safe
# to re-run: only rewrites values that are missing or stale.
sync-secrets:
	sh scripts/sync-dev-secrets.sh

# Applies TypeORM migrations to the dev database, from the host. Same env
# handling as 'npm run dev:api' (see package.json): .env sourced, then
# DB_HOST flipped to localhost — .env's 'db' service name only resolves
# inside Docker networking. Idempotent: TypeORM records executed migrations
# in its own table and skips them on re-run.
db-migrate:
	@set -a && . ./.env && set +a && DB_HOST=localhost npm run migration:run --workspace=apps/api

dev-up:
	sh scripts/dev-servers.sh start

dev-stop:
	sh scripts/dev-servers.sh stop

dev-status:
	sh scripts/dev-servers.sh status
# Full local bootstrap: bring up the stack, fetch Keycloak-generated client
# secrets into .env, then seed a login-capable app user.
deploy-dev-with-user:
	docker compose up -d --build
	infra/scripts/fetch-keycloak-dev-secrets.sh
	set -a && . ./.env && set +a && \
	KEYCLOAK_URL="http://localhost:8080" \
	BOOTSTRAP_ADMIN_EMAIL="$${DEV_SEED_USER_EMAIL}" \
	BOOTSTRAP_ADMIN_PASSWORD="$${DEV_SEED_USER_PASSWORD}" \
	npm run seed:admin --workspace=apps/api

# Same command a developer would run by hand, and the exact one
# .github/workflows/ci.yml's 'deploy' job runs on every push to main —
# infra/ansible/deploy.sh owns the real secret-import/Terraform/ansible-playbook
# logic so there's one definition of "how to deploy prod", not a second one
# duplicated here. Extra ansible-playbook args (e.g. '-e app_deploy_source=local')
# can still be passed through: 'make deploy-prod ARGS="-e app_deploy_source=local"'.
deploy-prod:
	infra/ansible/deploy.sh $(ARGS)
