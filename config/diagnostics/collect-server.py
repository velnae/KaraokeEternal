"""Read-only production evidence collector, also testable against a local fixture."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import sys


def collect(home, since, until, room):
    home = pathlib.Path(home)
    release = (home / 'karaoke-current').resolve()
    result = {'schemaVersion': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'release': str(release), 'fingerprints': {}, 'interventions': [], 'gaps': []}
    # Active release bytes, never the possibly newer Plesk checkout or .env.
    for relative in ['package.json', 'build/server/main.js',
                     'src/routes/Player/components/Animation/useAnimationPlayer.ts',
                     'src/routes/Player/components/Animation/AnnouncementAudio.ts']:
        source = release / relative
        if source.is_file():
            result['fingerprints'][relative] = hashlib.sha256(source.read_bytes()).hexdigest()
        else:
            result['gaps'].append('Missing release file: ' + relative)
    result['clientBundles'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in (release / 'build/client').glob('*.js')}
    for name, args in [
        ('service', ['systemctl', 'show', 'karaoke.service', '-p', 'ActiveState', '-p', 'NRestarts', '-p', 'MainPID']),
        ('journal', ['journalctl', '-u', 'karaoke.service', '--since', since, '--until', until,
                     '-n', '500', '--no-pager', '-o', 'short-iso-precise']),
    ]:
        try:
            response = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
            result[name] = response.stdout[-200000:]
            if response.returncode or response.stderr:
                result['gaps'].append(name + ': ' + response.stderr[-1000:])
        except (OSError, subprocess.TimeoutExpired) as error:
            result['gaps'].append(name + ': ' + str(error))
    try:
        start = int(datetime.datetime.fromisoformat(since.replace('Z', '+00:00')).timestamp() * 1000)
        end = int(datetime.datetime.fromisoformat(until.replace('Z', '+00:00')).timestamp() * 1000)
        database = home / 'karaoke-data/database.sqlite3'
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=2) as db:
            db.execute('PRAGMA query_only=ON')
            db.row_factory = sqlite3.Row
            result['interventions'] = [dict(row) for row in db.execute('''
                SELECT interventionId, roomId, clipChecksum, durationMs, status,
                       requestedAt, startedAt, finishedAt, leaseUntil, stopRequestedAt, reason
                FROM animationInterventions
                WHERE roomId=? AND requestedAt<=? AND COALESCE(finishedAt,?)>=?
                ORDER BY requestedAt DESC LIMIT 100
            ''', (room, end, end, start))]
    except (sqlite3.Error, OSError) as error:
        result['gaps'].append('interventions: ' + str(error))
    return result


if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))))
