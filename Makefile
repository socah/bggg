MODE_FILE := .claude/skills/active-mode.txt

# Three targets: mode-learning / mode-feature-dev write the mode file,
# mode-status reports the current mode (repairing it to "learning" if
# missing/invalid). $(MODE_FILE) is git-tracked, so switching modes is a
# working-tree change that is per-checkout/per-worktree — flipping the mode
# in one git worktree does not affect any other worktree or clone.
.DEFAULT_GOAL := mode-status

.PHONY: mode-learning mode-feature-dev mode-status deploy-dev deploy-prod

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

# Same command a developer would run by hand, and the exact one
# .github/workflows/ci.yml's 'deploy' job runs on every push to main —
# infra/ansible/deploy.sh owns the real secret-import/Terraform/ansible-playbook
# logic so there's one definition of "how to deploy prod", not a second one
# duplicated here. Extra ansible-playbook args (e.g. '-e app_deploy_source=local')
# can still be passed through: 'make deploy-prod ARGS="-e app_deploy_source=local"'.
deploy-prod:
	infra/ansible/deploy.sh $(ARGS)
