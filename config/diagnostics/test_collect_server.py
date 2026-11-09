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
                db.execute('CREATE TABLE rooms (roomId INTEGER, status TEXT, data TEXT)')
                db.execute('INSERT INTO rooms VALUES (1,?,?)', ('open', json.dumps({
                    'private': 'unrelated room details', 'prefs': {'animation': {
                        'enabled': True, 'automation': True, 'volume': 1,
                        'ambienceEnabled': True, 'ambienceVolume': 0.7,
                    }},
                })))
                db.execute('''CREATE TABLE animationInterventions (
                    interventionId TEXT, roomId INTEGER, clipChecksum TEXT, durationMs INTEGER,
                    status TEXT, requestedAt INTEGER, startedAt INTEGER, finishedAt INTEGER,
                    leaseUntil INTEGER, stopRequestedAt INTEGER, reason TEXT, displayText TEXT)''')
                for room in [1, 2]:
                    db.execute('INSERT INTO animationInterventions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                               (str(room), room, 'checksum', 8000, 'INTERRUPTED', 1794124800000,
                                1794124800000, 1794124803000, 1794124810000, None, 'stopped', 'private words'))
            before = database.read_bytes()
            with patch.object(collector.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'No journal permission')) as run:
                result = collector.collect(home, '2026-11-08T08:00:00Z', '2026-11-08T08:15:00Z', 1)
            journal_args = run.call_args_list[1].args[0]
            self.assertEqual(journal_args[journal_args.index('--since') + 1], '2026-11-08 08:00:00 UTC')
            self.assertEqual(journal_args[journal_args.index('--until') + 1], '2026-11-08 08:15:00 UTC')
            self.assertEqual(len(result['interventions']), 1)
            self.assertEqual(result['interventions'][0]['roomId'], 1)
            self.assertNotIn('private words', json.dumps(result))
            self.assertNotIn('unrelated room details', json.dumps(result))
            self.assertEqual(result['roomAudio'][0]['voiceVolume'], 1)
            self.assertEqual(result['roomAudio'][0]['ambienceVolume'], 0.7)
            self.assertIsInstance(result['journal'], list)
            self.assertEqual(database.read_bytes(), before)
            self.assertTrue(any('No journal permission' in gap for gap in result['gaps']))
            self.assertEqual(len(result['fingerprints']['package.json']), 64)


if __name__ == '__main__':
    unittest.main()
