MODE_FILE := .claude/skills/active-mode.txt

.PHONY: mode-learning mode-feature-dev mode-status

mode-learning:
	@echo learning > $(MODE_FILE)
	@echo "Active mode set to: learning"

mode-feature-dev:
	@echo feature-dev > $(MODE_FILE)
	@echo "Active mode set to: feature-dev"

mode-status:
	@echo "Active mode: $$(cat $(MODE_FILE) 2>/dev/null || echo 'learning (default, no mode file present)')"
