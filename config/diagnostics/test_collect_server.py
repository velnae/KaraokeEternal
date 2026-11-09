import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('collector', pathlib.Path(__file__).with_name('collect-server.py'))
assert spec and spec.loader
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTest(unittest.TestCase):
    def test_read_only_room_window_projection_and_partial_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            (home / 'karaoke-data').mkdir()
            (home / 'karaoke-current').mkdir()
            (home / 'karaoke-current/package.json').write_text('{}')
            database = home / 'karaoke-data/database.sqlite3'
            with sqlite3.connect(database) as db:
                db.execute('''CREATE TABLE animationInterventions (
                    interventionId TEXT, roomId INTEGER, clipChecksum TEXT, durationMs INTEGER,
                    status TEXT, requestedAt INTEGER, startedAt INTEGER, finishedAt INTEGER,
                    leaseUntil INTEGER, stopRequestedAt INTEGER, reason TEXT, displayText TEXT)''')
                for room in [1, 2]:
                    db.execute('INSERT INTO animationInterventions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                               (str(room), room, 'checksum', 8000, 'INTERRUPTED', 1794124800000,
                                1794124800000, 1794124803000, 1794124810000, None, 'stopped', 'private words'))
            before = database.read_bytes()
            with patch.object(collector.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'No journal permission')):
                result = collector.collect(home, '2026-11-08T08:00:00Z', '2026-11-08T08:15:00Z', 1)
            self.assertEqual(len(result['interventions']), 1)
            self.assertEqual(result['interventions'][0]['roomId'], 1)
            self.assertNotIn('private words', json.dumps(result))
            self.assertEqual(database.read_bytes(), before)
            self.assertTrue(any('No journal permission' in gap for gap in result['gaps']))
            self.assertEqual(len(result['fingerprints']['package.json']), 64)


if __name__ == '__main__':
    unittest.main()
