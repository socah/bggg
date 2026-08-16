MODE_FILE := .claude/skills/active-mode.txt

# Three targets: mode-learning / mode-feature-dev write the mode file,
# mode-status reports the current mode (repairing it to "learning" if
# missing/invalid). $(MODE_FILE) is git-tracked, so switching modes is a
# working-tree change that is per-checkout/per-worktree — flipping the mode
# in one git worktree does not affect any other worktree or clone.
.DEFAULT_GOAL := mode-status

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
