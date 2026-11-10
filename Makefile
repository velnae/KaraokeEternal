.DEFAULT_GOAL := help
DB_TOOLS = mise exec node@24.22.2 -- uv run --script db-tools.py

.PHONY: help db db-prod db-sync db-check db-config-check db-test

help: ## Show database tooling commands
	@python3 -c 'import re; print("\n".join(f"{m[1]:18} {m[2]}" for line in open("Makefile") if (m := re.match(r"^([\w-]+):.*?## (.*)", line))))'

db: ## Open local SQLite in sqlit
	@$(DB_TOOLS) sqlit karaoke

db-prod: ## Open live production SQLite over SSH (read-only sqlite3)
	@$(DB_TOOLS) sqlit karaoke-prod

db-sync: ## Refresh private local sqlit configuration
	@$(DB_TOOLS) sync karaoke

db-check: ## Verify both DBHub MCP sources; optionally connection=karaoke
	@$(DB_TOOLS) check $(connection)

db-config-check: ## Validate settings without connecting; optionally connection=karaoke
	@$(DB_TOOLS) config-check $(connection)

db-test: ## Run isolated database tooling regressions
	@$(DB_TOOLS) test
