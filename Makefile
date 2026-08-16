MODE_FILE := .claude/skills/active-mode.txt

.PHONY: mode-learning mode-feature-dev mode-status

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
