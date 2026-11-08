#!/usr/bin/env bash
set -euo pipefail
umask 077

export PATH="/opt/plesk/node/24/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_ENV=production
home=/var/www/vhosts/karaoke.puyu.pe
source_dir="$home/httpdocs"
mkdir -p "$home/releases" "$home/backups"
exec 9>"$home/.deployment.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
release=$(mktemp -d "$home/releases/release-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")

rsync -a --exclude=.env --exclude=.git --exclude=node_modules --exclude=build \
  --exclude='*.tsbuildinfo' "$source_dir/" "$release/"
cd "$release"
grep -Fq 'process.env.KES_HOST' server/serverWorker.ts || {
  echo 'Deployment refused: source must support KES_HOST for private binding.' >&2
  exit 1
}
npm ci --include=dev
npm run typecheck
npx --no-install tsc -p config/tsconfig.server.json --noEmitOnError
mkdir -p build/server/lib
cp -R server/lib/schemas build/server/lib/
npm run build:client

# Refuse older code: the application otherwise runs missing migrations down.
python3 - "$home" "$release" <<'PY'
import pathlib, sqlite3, sys
home, release = map(pathlib.Path, sys.argv[1:])
database = home / 'karaoke-data/database.sqlite3'
if database.exists():
    db = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
    applied = {row[0] for row in db.execute('SELECT id FROM migrations')}
    available = {int(p.name.split('-')[0]) for p in (release / 'server/lib/schemas').glob('*.sql')}
    missing = applied - available
    if missing:
        raise SystemExit(f'Deployment refused: missing applied migrations {sorted(missing)}')
    backup = sqlite3.connect(home / 'backups' / (release.name + '.sqlite3'))
    db.backup(backup)
    assert backup.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
    backup.close()
    db.close()
PY

ln -s "$release" "$home/.karaoke-current-next"
mv -Tf "$home/.karaoke-current-next" "$home/karaoke-current"
if [[ "${PREPARE_ONLY:-0}" == 1 ]]; then
  echo "Prepared $release; service not started."
  exit 0
fi
sudo -n /usr/bin/systemctl restart karaoke.service
for attempt in {1..30}; do
  if curl --fail --silent --output /dev/null http://127.0.0.1:3010/; then
    echo "Deployment healthy: $release"
    exit 0
  fi
  sleep 2
done
sudo -n /usr/bin/systemctl stop karaoke.service
echo 'Deployment health check failed. Service stopped; inspect journalctl -u karaoke.' >&2
exit 1
