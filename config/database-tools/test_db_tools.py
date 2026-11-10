"""Launcher regressions use synthetic settings and never contact the VPS."""
import importlib.util
import asyncio
import json
import os
from pathlib import Path
import shlex
import sqlite3
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("db_tools", ROOT / "db-tools.py")
assert spec is not None and spec.loader is not None
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class DatabaseToolsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="karaoke-db-tools-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "data with spaces" / "database.sqlite3"
        self.database.parent.mkdir()
        connection = sqlite3.connect(self.database)
        connection.execute("CREATE TABLE sentinel (value TEXT)")
        connection.close()
        (self.root / ".env").write_text(f'KES_PATH_DATA="{self.database.parent}"\n')
        (self.root / ".env.prod").write_text(
            'DB_TOOLS_SSH_HOST=fixture-host\nDB_TOOLS_DATABASE="/remote/data with spaces/database.sqlite3"\n'
        )
        (self.root / "config").mkdir()
        (self.root / "config/dbhub.prod.toml").write_text((ROOT / "config/dbhub.prod.toml").read_text())

    def test_local_path_and_missing_file_do_not_create_database(self):
        self.assertEqual(tools.settings("karaoke", self.root)["database"], str(self.database))
        self.database.unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            tools.settings("karaoke", self.root)
        self.assertFalse(self.database.exists())

    def test_relative_override_and_production_independence(self):
        relative = self.database.relative_to(self.root)
        (self.root / ".env").write_text(f'DB_TOOLS_DATABASE="{relative}"\n')
        (self.root / ".env.prod").unlink()
        self.assertEqual(tools.settings("karaoke", self.root)["database"], str(self.database))
        with self.assertRaisesRegex(ValueError, "Missing .env.prod"):
            tools.settings("karaoke-prod", self.root)

    def test_private_sync_preserves_other_connections_and_history(self):
        directory = self.root / ".sqlit"
        directory.mkdir()
        (directory / "connections.template.json").write_text((ROOT / ".sqlit/connections.template.json").read_text())
        destination = directory / "connections.json"
        destination.write_text(json.dumps({"version": 2, "connections": [{"name": "other"}, {"name": "karaoke"}]}))
        history = directory / "history.json"
        history.write_text('["SELECT 1"]')
        tools.sync_sqlit(tools.settings("karaoke", self.root), self.root)
        result = json.loads(destination.read_text())
        self.assertEqual([item["name"] for item in result["connections"]], ["other", "karaoke"])
        self.assertEqual(result["connections"][1]["endpoint"]["path"], str(self.database))
        self.assertEqual(history.read_text(), '["SELECT 1"]')
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_remote_command_preserves_stdio_quoting_and_readonly_config(self):
        command, _ = tools.dbhub_command("karaoke-prod", self.root)
        self.assertIn("-T", command)
        self.assertIn("BatchMode=yes", command)
        remote = shlex.split(command[-1])
        self.assertEqual(remote[:2], ["python3", "-c"])
        settings, config, dbhub = json.loads(remote[-1])
        self.assertEqual(settings["database"], "/remote/data with spaces/database.sqlite3")
        self.assertTrue(tomllib.loads(config)["tools"][0]["readonly"])
        self.assertIn("@bytebase/dbhub@1.5.0", dbhub)

    def test_remote_runner_refuses_missing_file(self):
        missing = self.root / "does-not-exist.sqlite3"
        payload = json.dumps([{"database": str(missing)}, "", ["should-never-run"]])
        result = subprocess.run(["python3", "-c", tools.REMOTE_DBHUB, payload], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing to create", result.stderr)
        self.assertFalse(missing.exists())

    def test_local_command_uses_node24_and_dsn_preserves_spaces(self):
        with patch.object(tools.subprocess, "check_output", return_value="v24.22.2\n"):
            command, environment = tools.dbhub_command("karaoke", self.root)
        self.assertEqual(environment["KARAOKE_DBHUB_DSN"], "sqlite://" + str(self.database))
        self.assertEqual(command[-1], str(self.root / "dbhub.toml"))
        with patch.object(tools.subprocess, "check_output", return_value="v26.12.0\n"):
            with self.assertRaisesRegex(ValueError, "Node 24"):
                tools.dbhub_command("karaoke", self.root)

    def test_invalid_remote_host_and_paths_are_rejected(self):
        for content in [
            "DB_TOOLS_SSH_HOST=-oProxyCommand=bad\nDB_TOOLS_DATABASE=/remote/db\n",
            "DB_TOOLS_SSH_HOST=fixture\nDB_TOOLS_DATABASE=relative/db\n",
            "DB_TOOLS_SSH_HOST=fixture\nDB_TOOLS_DATABASE=/remote/db?mode=rw\n",
        ]:
            with self.subTest(content=content):
                (self.root / ".env.prod").write_text(content)
                with self.assertRaises(ValueError):
                    tools.settings("karaoke-prod", self.root)


class McpContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_production_config_reads_but_rejects_writes_on_isolated_sqlite(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        with tempfile.TemporaryDirectory(prefix="karaoke-mcp-contract-") as directory:
            database = Path(directory) / "fixture with spaces.sqlite3"
            connection = sqlite3.connect(database)
            connection.execute("CREATE TABLE sentinel (value TEXT)")
            connection.close()
            server = StdioServerParameters(
                command=tools.DBHUB[0],
                args=tools.DBHUB[1:] + ["--config", str(ROOT / "config/dbhub.prod.toml")],
                env={**os.environ, "KARAOKE_DBHUB_DSN": "sqlite://" + str(database)},
            )
            async with asyncio.timeout(90):
                async with stdio_client(server) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        names = {tool.name for tool in (await session.list_tools()).tools}
                        self.assertEqual(names, {"execute_sql", "search_objects"})
                        result = await session.call_tool("execute_sql", {"sql": "SELECT 1 AS connection_ok"})
                        self.assertFalse(result.isError)
                        self.assertIn("connection_ok", str(result.content))
                        discovery = await session.call_tool("search_objects", {"object_type": "table", "schema": "main", "detail_level": "names"})
                        self.assertFalse(discovery.isError)
                        self.assertIn("sentinel", str(discovery.content))
                        denied = await session.call_tool("execute_sql", {"sql": "CREATE TABLE forbidden (id INTEGER)"})
                        self.assertTrue(denied.isError)
            connection = sqlite3.connect(database)
            try:
                self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name='forbidden'").fetchone())
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
