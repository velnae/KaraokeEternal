# Access SQLite with DBHub and Make

Agents manage databases through **DBHub MCP**. People use **sqlit locally** and
a **read-only sqlite3 console over SSH in production**. Both use `db-tools.py`
and the same private settings; the production connection reads the live VPS
database without copying it or exposing a database port.

## Quick start

Prerequisites on the workstation: mise with Node **24.22.2**, uv, sqlit and SSH.
The VPS needs Python 3, Node 24.22.2 with npx, and sqlite3. The deployment already
provides these. DBHub **1.5.0**, python-dotenv **1.2.1** and MCP SDK **1.26.0**
are pinned; uv/npx cache their packages on first use and need network access then.

```sh
make db                                # Local sqlit
make db-prod                           # Live VPS sqlite3, read-only
make db-sync                           # Refresh local sqlit settings
make db-config-check                   # Validate settings without connecting
make db-check connection=karaoke        # SELECT 1 through local DBHub MCP
make db-check connection=karaoke-prod   # SELECT 1 through production DBHub MCP
make db-check                          # Verify both MCP connections
make db-test                           # Isolated launcher regression tests
```

OpenCode starts two independent stdio MCP processes from `opencode.json`:
`dbhub` and `dbhub-prod`. Restart OpenCode after installing configuration/skills.
Reconnect the affected MCP after changing dotenv settings. No Make command or
sqlit synchronization is needed to start MCP. First package downloads can exceed
the MCP startup timeout; run the appropriate `make db-check` before reconnecting.

## Private settings

| Source | File | Settings |
| --- | --- | --- |
| `karaoke` | Existing `.env` | `KES_PATH_DATA`; optional tools-only `DB_TOOLS_DATABASE` overrides the database file |
| `karaoke-prod` | `.env.prod` (copy `.env.prod.example`) | `DB_TOOLS_SSH_HOST`, absolute `DB_TOOLS_DATABASE`, `DB_TOOLS_NODE_BIN` |

Local data defaults to `~/.config/Karaoke Eternal Server/database.sqlite3`, matching
the Linux application default. Relative local paths resolve from the project root.
If the application uses a `--data` CLI override, set `DB_TOOLS_DATABASE` to its
actual SQLite file. Tools refuse missing database files; they never initialize
or migrate them. Quoting and `${VARIABLE}` expansion use python-dotenv; dotenv
files are not executed as shell scripts. Environment settings come from those
files; the launcher does not import the application's provider keys into DBHub.

Production defaults match the deployment: SSH alias `karaoke`, database
`/var/www/vhosts/karaoke.puyu.pe/karaoke-data/database.sqlite3`, Node directory
`/opt/plesk/node/24/bin`. Authentication uses the existing SSH config/agent with
batch mode and normal host-key verification. Keep keys outside the repository.
`.env.prod` is only workstation tooling configuration, not a copy of the server's
application `.env`. Database paths containing `?`, `#`, `%` or newlines are rejected
because DBHub's SQLite DSN parser does not preserve those literal characters.

## Live production access

SQLite is file-based: an SSH TCP tunnel cannot make a remote SQLite file usable
by a local connector. The launcher runs pinned DBHub **on the VPS** via SSH
stdio and passes `config/dbhub.prod.toml` into a private temporary directory,
removed on normal exit. npx may populate the application user's package cache;
no service deployment or persistent DBHub listener is needed. Local DBHub uses
root `dbhub.toml` and opens only the local file.

The VPS has sqlite3 but no sqlit, so `make db-prod` uses its existing
`sqlite3 -readonly` command with an SSH terminal. Exit with `.quit`.
`make db-sync` refreshes only the local sqlit connection. It atomically writes
mode-600 `.sqlit/connections.json` in a mode-700 directory while preserving other
connections and query history. The template is safe to version; generated state
and both private dotenv files are ignored by Git.

Never mount a live SQLite database over SSHFS or copy only its main file: commits
may still reside in the WAL. Keep development and VPS data independent.

## Agent query policy

Select MCP server `dbhub` for `karaoke` or `dbhub-prod` for `karaoke-prod`.
Each exposes `search_objects` and `execute_sql` without source suffixes: DBHub
1.5.0 adds those suffixes only for multi-source servers. Use `search_objects`
progressively: schemas → table names → relevant summaries → full details.
Query with `execute_sql`, using `main.table` names.
Both configurations cap results at **200 rows** and request a **30-second query
timeout**; SQLite's synchronous connector does not guarantee interruption of a
long-running statement, so keep queries bounded.

Local writes need an authorized task. Production queries need an explicit
production request and `execute_sql` is technically read-only, including opening
the SQLite connection read-only. A production write requires explicit authorization
for both its scope and the configuration change. Never bypass a rejected write
through another client. Prefer aggregates; avoid extracting secrets or private rows.

`make db-check` performs a real MCP handshake, verifies the expected source tool
and calls `SELECT 1`; it does not rely on sqlit connectivity. Each source check
is bounded to 90 seconds. Load the `dbhub-setup` and `dbhub-explore` skills as
directed in `AGENTS.md`.
