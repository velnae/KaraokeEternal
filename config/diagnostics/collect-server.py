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
    start_time = datetime.datetime.fromisoformat(since.replace('Z', '+00:00'))
    end_time = datetime.datetime.fromisoformat(until.replace('Z', '+00:00'))
    # systemd 249 does not accept the CLI's ISO T/Z timestamps.
    journal_since = start_time.astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    journal_until = end_time.astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
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
        ('journal', ['journalctl', '-u', 'karaoke.service', '--since', journal_since, '--until', journal_until,
                     '-n', '500', '--no-pager', '-o', 'short-iso-precise']),
    ]:
        try:
            response = subprocess.run(args, capture_output=True, text=True, timeout=15, check=False)
            result[name] = response.stdout[-200000:]
            if name == 'journal':
                result[name] = result[name].splitlines()
            if response.returncode or response.stderr:
                result['gaps'].append(name + ': ' + response.stderr[-1000:])
        except (OSError, subprocess.TimeoutExpired) as error:
            result['gaps'].append(name + ': ' + str(error))
    try:
        start = int(start_time.timestamp() * 1000)
        end = int(end_time.timestamp() * 1000)
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
            queries = {
                'roomAudio': '''SELECT roomId, status,
                    json_extract(data,'$.prefs.animation.enabled') AS enabled,
                    json_extract(data,'$.prefs.animation.automation') AS automation,
                    json_extract(data,'$.prefs.animation.volume') AS voiceVolume,
                    json_extract(data,'$.prefs.animation.ambienceEnabled') AS ambienceEnabled,
                    json_extract(data,'$.prefs.animation.ambienceVolume') AS ambienceVolume
                    FROM rooms WHERE roomId=?''',
                'animationState': '''SELECT roomId, playerEpoch, controlVersion, blockedUntil, lastOmission,
                    json_extract(ambienceJSON,'$.until') AS ambienceUntil,
                    json_extract(pendingEventJSON,'$.family') AS pendingFamily
                    FROM animationRoomState WHERE roomId=?''',
                'sessions': '''SELECT sessionId, status, openedAt, closedAt
                    FROM animationSessions WHERE roomId=? ORDER BY openedAt DESC LIMIT 3''',
                'queueActivity': '''SELECT queueId, status, source FROM queue WHERE roomId=?
                    ORDER BY queueId DESC LIMIT 10''',
            }
            for name, query in queries.items():
                try:
                    result[name] = [dict(row) for row in db.execute(query, (room,))]
                except sqlite3.Error as error:
                    result['gaps'].append(name + ': ' + str(error))
    except (sqlite3.Error, OSError) as error:
        result['gaps'].append('interventions: ' + str(error))
    return result


if __name__ == '__main__':
    print(json.dumps(collect(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))))
