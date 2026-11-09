import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('production_backup', Path(__file__).with_name('production-backup.py'))
assert spec is not None and spec.loader is not None
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_includes_committed_wal_and_is_independent_of_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'live.sqlite3'
            destination = Path(directory) / 'backup.sqlite3'
            with sqlite3.connect(source) as writer:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('PRAGMA wal_autocheckpoint=0')
                writer.execute('CREATE TABLE items (value TEXT)')
                writer.execute("INSERT INTO items VALUES ('before')")
                writer.commit()
                self.assertTrue(Path(str(source) + '-wal').exists())
                checksum = backup.backup_database(source, destination)
                writer.execute("INSERT INTO items VALUES ('after')")
                writer.commit()
            writer.close()
            with sqlite3.connect(destination) as restored:
                self.assertEqual(restored.execute('SELECT value FROM items').fetchall(), [('before',)])
                self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone(), ('ok',))
            restored.close()
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(checksum), 64)
            self.assertFalse(Path(str(destination) + '-wal').exists())

    def test_refuses_existing_destination_without_changing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'live.sqlite3'
            source.write_bytes(b'existing data')
            with self.assertRaises(FileExistsError):
                backup.backup_database(source, source)
            self.assertEqual(source.read_bytes(), b'existing data')

    def test_invalid_database_does_not_publish_or_leave_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'invalid.sqlite3'
            source.write_bytes(b'not a database')
            destination = Path(directory) / 'backup.sqlite3'
            with self.assertRaises(sqlite3.DatabaseError):
                backup.backup_database(source, destination)
            self.assertFalse(destination.exists())
            self.assertEqual(list(Path(directory).iterdir()), [source])

    def test_expired_backup_does_not_publish_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'live.sqlite3'
            with sqlite3.connect(source) as writer:
                writer.execute('CREATE TABLE items (value TEXT)')
            writer.close()
            destination = Path(directory) / 'backup.sqlite3'
            with patch.object(backup.time, 'monotonic', side_effect=[0, 61]):
                with self.assertRaises(TimeoutError):
                    backup.backup_database(source, destination, timeout=60)
            self.assertFalse(destination.exists())
            self.assertEqual(list(Path(directory).iterdir()), [source])


if __name__ == '__main__':
    unittest.main()
