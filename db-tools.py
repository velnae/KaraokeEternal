# /// script
# requires-python = ">=3.11"
# dependencies = ["python-dotenv==1.2.1", "mcp==1.26.0"]
# ///
"""Launch database clients without exposing SQLite over the network."""
import argparse
import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import sys
import tempfile
import tomllib

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent
NAMES = ("karaoke", "karaoke-prod")
DBHUB = ["npx", "--yes", "@bytebase/dbhub@1.5.0", "--transport", "stdio"]

# Executed with python3 -c so SSH stdin remains dedicated to the MCP protocol.
# Only the temporary tool config and npm's package cache are written on the VPS.
REMOTE_DBHUB = """
import json, os, pathlib, subprocess, sys, tempfile
settings, config, command = json.loads(sys.argv[1])
database = pathlib.Path(settings['database'])
if not database.is_file():
    sys.exit('Production SQLite file is missing; refusing to create it.')
os.environ['PATH'] = settings['node_bin'] + os.pathsep + os.environ['PATH']
if subprocess.check_output(['node', '--version'], text=True).strip() != 'v24.22.2':
    sys.exit('DBHub requires Node 24.22.2.')
os.environ['KARAOKE_DBHUB_DSN'] = 'sqlite://' + str(database)
with tempfile.TemporaryDirectory(prefix='karaoke-dbhub-') as directory:
    path = pathlib.Path(directory) / 'dbhub.toml'
    path.write_text(config)
    path.chmod(0o600)
    sys.exit(subprocess.call(command + ['--config', str(path)]))
"""


def settings(name, root=ROOT):
    production = name == "karaoke-prod"
    env_file = root / (".env.prod" if production else ".env")
    if production and not env_file.is_file():
        raise ValueError("Missing .env.prod; copy .env.prod.example first.")
    values = dotenv_values(env_file) if env_file.is_file() else {}
    if production:
        host = values.get("DB_TOOLS_SSH_HOST") or "karaoke"
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@-]*", host):
            raise ValueError("DB_TOOLS_SSH_HOST must be an SSH alias or user@host.")
        database = values.get("DB_TOOLS_DATABASE") or ""
        node_bin = values.get("DB_TOOLS_NODE_BIN") or "/opt/plesk/node/24/bin"
        if not PurePosixPath(database).is_absolute() or not PurePosixPath(node_bin).is_absolute():
            raise ValueError("Production database and Node directory must be absolute paths.")
        result = dict(database=database, host=host, node_bin=node_bin)
    else:
        data = values.get("KES_PATH_DATA") or str(Path.home() / ".config/Karaoke Eternal Server")
        database = Path(values.get("DB_TOOLS_DATABASE") or str(Path(data) / "database.sqlite3")).expanduser()
        if not database.is_absolute():
            database = root / database
        if not database.is_file():
            raise ValueError("Local SQLite file is missing; verify KES_PATH_DATA or DB_TOOLS_DATABASE.")
        result = dict(database=str(database.resolve()))
    # DBHub 1.5.0 treats these as URL delimiters, not literal path characters.
    if any(character in result["database"] for character in "?#%\n\r"):
        raise ValueError("Database path contains unsupported DSN characters.")
    return result


def ssh_command(config, command, interactive=False):
    return ["ssh", "-tt" if interactive else "-T", "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10", config["host"], shlex.join(command)]


def dbhub_command(name, root=ROOT):
    config = settings(name, root)
    if name == "karaoke-prod":
        payload = json.dumps([config, (root / "config/dbhub.prod.toml").read_text(), DBHUB])
        return ssh_command(config, ["python3", "-c", REMOTE_DBHUB, payload]), os.environ.copy()
    if subprocess.check_output(["node", "--version"], text=True).strip() != "v24.22.2":
        raise ValueError("DBHub requires Node 24.22.2; use mise exec node@24.22.2.")
    environment = {**os.environ, "KARAOKE_DBHUB_DSN": "sqlite://" + config["database"]}
    return DBHUB + ["--config", str(root / "dbhub.toml")], environment


def sync_sqlit(config, root=ROOT):
    directory = root / ".sqlit"
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    template = json.loads((directory / "connections.template.json").read_text())
    connection = template["connections"][0]
    connection["endpoint"]["path"] = config["database"]
    destination = directory / "connections.json"
    existing = json.loads(destination.read_text()) if destination.exists() else {"version": 2, "connections": []}
    if existing.get("version") != 2:
        raise ValueError("Unsupported sqlit config version.")
    existing["connections"] = [item for item in existing["connections"] if item["name"] != "karaoke"] + [connection]
    descriptor, temporary = tempfile.mkstemp(prefix="connections-", suffix=".json", dir=directory)
    try:
        with os.fdopen(descriptor, "w") as handle:
            json.dump(existing, handle, indent=2)
            handle.write("\n")
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


async def check_connections(names):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    for name in names:
        command, environment = dbhub_command(name)
        server = StdioServerParameters(command=command[0], args=command[1:], env=environment)
        async with asyncio.timeout(90):
            async with stdio_client(server) as (read, write):
                async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=60)) as session:
                    await session.initialize()
                    tools = {tool.name for tool in (await session.list_tools()).tools}
                    tool = "execute_sql"
                    if tool not in tools:
                        raise ValueError(f"Missing expected MCP tool: {tool}")
                    result = await session.call_tool(tool, {"sql": "SELECT 1 AS connection_ok"})
                    if result.isError:
                        raise ValueError(f"{name}: DBHub SELECT 1 failed.")
                    print(f"{name}: DBHub MCP SELECT 1 OK", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("dbhub", "sqlit", "sync", "check", "config-check", "test"))
    parser.add_argument("connection", nargs="?", choices=NAMES)
    args = parser.parse_args()
    if args.command == "test":
        return subprocess.call([sys.executable, "-B", "-m", "unittest", "discover", "-s", str(ROOT / "config/database-tools"), "-v"])
    if args.command == "check":
        asyncio.run(check_connections([args.connection] if args.connection else NAMES))
    elif args.command == "config-check":
        for name in [args.connection] if args.connection else NAMES:
            settings(name)
            path = ROOT / ("config/dbhub.prod.toml" if name == "karaoke-prod" else "dbhub.toml")
            tomllib.loads(path.read_text())
            print(f"{name}: configuration valid; no connections opened.")
    elif args.command == "dbhub":
        if not args.connection:
            parser.error("DBHub requires an explicit connection.")
        command, environment = dbhub_command(args.connection)
        os.execvpe(command[0], command, environment)
    else:
        name = args.connection or "karaoke"
        config = settings(name)
        if name == "karaoke-prod":
            if args.command == "sync":
                parser.error("sqlit cannot open remote SQLite; only local sync is supported.")
            # sqlite3 is installed on the VPS; sqlit is not. Never mount live WAL files.
            command = ssh_command(config, ["sqlite3", "-readonly", config["database"]], interactive=True)
            os.execvp(command[0], command)
        sync_sqlit(config)
        if args.command == "sqlit":
            os.execvp("sqlit", ["sqlit", str(ROOT), "-c", "karaoke"])
        print("Updated private local sqlit connection.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(f"Database setup failed: {error} See docs/database-tools.md.", file=sys.stderr)
        sys.exit(1)
