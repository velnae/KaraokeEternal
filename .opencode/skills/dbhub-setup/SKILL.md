---
name: dbhub-setup
description: "Trigger: DBHub setup, MCP connection failure, make db, sqlit sync. Configure and diagnose Karaoke Eternal database clients."
license: MIT
metadata:
  author: bytebase
  version: "1.5.0-karaoke.1"
---

# DBHub Setup

## Activation Contract
Load when configuring database clients or diagnosing DBHub connectivity.

## Hard Rules
- Read `.env` (local) and `.env.prod` (VPS tooling) through `db-tools.py`; never expose secrets or copy another project's credentials.
- Preserve `KES_PATH_DATA`, the existing database and its WAL/SHM files. Refuse missing files instead of creating empty databases.
- Keep production read-only; obtain explicit authorization before changing its write policy or querying production.
- Run DBHub with Node 24.22.2. Keep MCP stdout dedicated to protocol messages.

## Decision Gates
- Missing `.env.prod`: copy `.env.prod.example` locally; use the existing `karaoke` SSH alias, not a copied private key.
- Local-only work: select `connection=karaoke`; a missing VPS must not block local tools.
- Remote SQLite: run DBHub on the VPS over SSH stdio. Do not use network mounts, raw file copies or MySQL tunnels.

## Execution Steps
1. Read the database workflow and run `make db-config-check` without connecting.
2. Verify local MCP with `make db-check connection=karaoke`; verify production only when requested using `connection=karaoke-prod`.
3. Use `make db-sync` for local sqlit; `make db-prod` opens remote read-only sqlite3 because the VPS has no sqlit.
4. Restart OpenCode after config/skill changes; reconnect DBHub after dotenv edits.
5. Run `make db-test` for isolated launcher regressions. MCP startup alone does not prove query access.

## Output Contract
State which sources were configured and actually queried. Report missing prerequisites and restart requirements without claiming unverified access.

## References
- [Database workflow](../../../../docs/database-tools.md)
- [Upstream and license](references/upstream.md)
