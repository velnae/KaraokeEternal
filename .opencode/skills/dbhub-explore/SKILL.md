---
name: dbhub-explore
description: "Trigger: DBHub, database schema, SQL discovery. Explore local or production Karaoke Eternal SQLite through MCP."
license: MIT
metadata:
  author: bytebase
  version: "1.5.0-karaoke.1"
---

# DBHub Schema Exploration

## Activation Contract
Load before discovering schemas or querying project databases.

## Hard Rules
- Use DBHub MCP and explicitly select server `dbhub` (local `karaoke`) or `dbhub-prod` (live VPS `karaoke-prod`). Each exposes unsuffixed `search_objects` and `execute_sql` tools.
- Require an explicit production request before production queries. Permit local writes only for authorized tasks; production is technically read-only.
- Stop on a rejected write. Never switch clients to bypass DBHub restrictions.
- Discover columns and keys before JOINs; use `main.table` names, aggregate queries and `LIMIT 10` for samples.
- Avoid retrieving password hashes, session keys or provider credentials.

## Decision Gates
- Missing MCP tools: load `dbhub-setup`; do not substitute direct database clients for agent queries.
- A task needs a production write: obtain authorization for the operation and configuration change first.

## Execution Steps
1. Discover schemas with `search_objects`, `object_type: "schema"`.
2. List table `names` within `main` on the intended source.
3. Narrow with a pattern and `summary` detail; request `full` only for relevant tables.
4. Search `object_type: "column"` to locate a concept, then execute bounded SQL.
5. Report truncation; narrow the query rather than downloading the database.

## Output Contract
Report the source, schema, findings and permission or truncation limits. Distinguish local evidence from production evidence.

## References
- [Database workflow](../../../../docs/database-tools.md)
- [Upstream and license](../dbhub-setup/references/upstream.md)
