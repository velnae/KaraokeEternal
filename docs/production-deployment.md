# Deploy Karaoke Eternal with Plesk and systemd

Production runs at **https://karaoke.puyu.pe/** on **74.208.127.50**.
Plesk publishes Git into `httpdocs`; a deployment action builds a separate
release and restarts one persistent Node process behind Nginx.
Development uses **https://dev-karaoke.puyu.pe/** and an independent local database.

## Files and ownership

| Versioned file | Installed destination / purpose |
| --- | --- |
| `config/production-deploy.sh` | Plesk post-deployment action, executed as `karaoke` |
| `config/karaoke.service` | `/etc/systemd/system/karaoke.service`, owned by root |
| `config/production/sudoers` | `/etc/sudoers.d/karaoke-deploy`, root, mode `440` |
| `config/production/nginx.conf` | Plesk additional Nginx directives for this domain |
| `config/production/env.example` | Private `~/httpdocs/.env`, owned by `karaoke`, mode `600` |
| `config/production-backup.py` | Standalone SQLite snapshot tool; Python standard library only |
| `server/serverWorker.ts` | Honors `KES_HOST`; service binds to `127.0.0.1` |

Paths below assume `/var/www/vhosts/karaoke.puyu.pe`, user `karaoke`, group
`psacln`, Node under `/opt/plesk/node/24`, and port `3010`. Adapt all templates
and the deployment script together when provisioning a different installation.
The script is specific to this deployment, not a general Plesk installer.

```text
/var/www/vhosts/karaoke.puyu.pe/
├── httpdocs/          # Plesk Git working files; private .env stays here
├── releases/          # Compiled versions, each with node_modules
├── karaoke-current -> releases/release-...
├── karaoke-data/      # database.sqlite3 and persistent resources
└── backups/           # SQLite snapshots before deployments
```

Keep `.env`, provider keys, database snapshots, media and private TLS/tunnel
credentials outside Git. Service templates are versioned; installed service
and sudoers files are not updated automatically by ordinary deployments.

## 1. Prepare a new VPS

Use `ssh puyu-pe` for administrative setup and `ssh karaoke` for application
operations. Create the Plesk subscription/system user and Git integration first.
Publish this repository's `develop` branch to `/httpdocs`; leave post-deployment
actions disabled until initial setup is complete.

Install Node 24 through Plesk's Node.js version manager. This installation uses
Node **24.22.2**, npm **11.19.1**, and Ubuntu 22.04 FFmpeg **4.4.2**. Other patch
versions need validation; the application requires Node >=24 and npm >=11.
Python 3, rsync, curl and flock must also be available.

As administrator, inspect the package transaction before installing:

```sh
sudo apt-get update
sudo apt-get --simulate install --no-install-recommends ffmpeg python3 rsync curl util-linux
sudo env NEEDRESTART_MODE=l apt-get install --no-install-recommends ffmpeg python3 rsync curl util-linux
```

As `karaoke`:

```sh
nodenv global 24
nodenv exec node --version
nodenv exec npm --version
nodenv exec node -e 'console.log(typeof require("node:sqlite").DatabaseSync)'
ffmpeg -version
ffprobe -version
install -d -m 700 "$HOME/karaoke-data" "$HOME/backups" "$HOME/releases"
```

Here, `~/.nodenv/versions` points to Plesk's `/opt/plesk/node`. Noninteractive
shells may lack nodenv shims: use `nodenv exec`. The service and deployment
script explicitly select `/opt/plesk/node/24/bin` instead.

## 2. Prepare environment and data

On a **new installation only**, create the private environment as `karaoke`:

```sh
test ! -e "$HOME/httpdocs/.env" && install -m 600 "$HOME/httpdocs/config/production/env.example" "$HOME/httpdocs/.env"
```

Edit that private file on the server and supply the required provider keys.
The template sets production mode, port 3010, root URL path, private data path,
FFmpeg paths and no session-key rotation. Do not copy development-only controls
or browser-tool tokens. Existing installations retain their `.env` unchanged.

For migration, deploy code containing **every migration already applied to the
source database**. The application can run missing migrations down; the
deployment script rejects such an older schema set before activation.

An initial online snapshot is useful for rehearsal. For the **final transfer**,
pause writes and stop the source cleanly so the database and resource files
represent the same point in time. Keep the destination stopped as well.
Do not perform this procedure against an already-active destination receiving
new orders: that needs a separate reconciliation decision.

Example from the source machine, using a new private staging directory:

```sh
systemctl --user stop karaoke-eternal.service
umask 077
snapshot_dir=$(mktemp -d)
python3 config/production-backup.py \
  "$HOME/.config/Karaoke Eternal Server/database.sqlite3" \
  "$snapshot_dir/database.sqlite3"
rsync -a --no-owner --no-group --chmod=D700,F600 \
  --exclude=/database.sqlite3 --exclude=/database.sqlite3-wal --exclude=/database.sqlite3-shm \
  "$HOME/.config/Karaoke Eternal Server/" \
  karaoke:/var/www/vhosts/karaoke.puyu.pe/karaoke-data/
rsync -a --chmod=F600 "$snapshot_dir/database.sqlite3" \
  karaoke:/var/www/vhosts/karaoke.puyu.pe/karaoke-data/database.sqlite3
```

This assumes a fresh destination, with no WAL/SHM files left by another process.
For a reused rehearsal directory, back it up and stage into a new empty data
directory rather than replacing a database under stale sidecars. Inventory any
external library paths registered in SQLite and copy/remap those too. At the
original cutover, the library paths table was empty.

Resources include `animation/`, `greetings/`, `transition-video/`, `birthdays/`
and `player-logo-images/`; copy the complete data directory, not a fixed subset.
Compare the transferred snapshot's SHA256 and run `PRAGMA integrity_check` on
the destination before starting it. Never copy only the live main SQLite file:
committed changes may still be in its WAL.

## 3. Install service and deployment permission

As administrator on the VPS:

```sh
sudo visudo -cf /var/www/vhosts/karaoke.puyu.pe/httpdocs/config/production/sudoers
sudo install -o root -g root -m 440 /var/www/vhosts/karaoke.puyu.pe/httpdocs/config/production/sudoers /etc/sudoers.d/karaoke-deploy
sudo install -o root -g root -m 644 /var/www/vhosts/karaoke.puyu.pe/httpdocs/config/karaoke.service /etc/systemd/system/karaoke.service
sudo systemctl daemon-reload
```

The sudoers rule grants only restart/stop of `karaoke.service`; dependencies and
build commands run as the unprivileged application user. The service uses
`KES_HOST=127.0.0.1`, `UMask=0077`, graceful shutdown and automatic restart.

Prepare the first release as `karaoke`, **while the service is stopped**:

```sh
PREPARE_ONLY=1 bash "$HOME/httpdocs/config/production-deploy.sh"
```

`PREPARE_ONLY` still changes `karaoke-current`; it skips only the restart and
health check. It is not a dry run. After preparation, as administrator:

```sh
sudo systemd-analyze verify /etc/systemd/system/karaoke.service
sudo systemctl enable --now karaoke.service
sudo systemctl status karaoke.service --no-pager
```

## 4. Configure Nginx, TLS and DNS

In Plesk, use `config/production/nginx.conf` as the domain's additional Nginx
directives, replacing any existing `location /`. Disable direct static-file
serving for this application; Node serves its built assets and dynamic HTML.
If Plesk generates a conflicting `location /`, disable its Apache proxy mode
for this Node-only domain before adding the custom block.
Do not edit Plesk's generated `nginx.conf`; Plesk regenerates it. Keep the upload
limit at least as large as the application's supported uploads (the deployed
virtual host uses 128 MiB). Port 3010 stays private.

Install and assign a valid certificate for `karaoke.puyu.pe` through Plesk
(the current certificate is `Lets Encrypt karaoke.puyu.pe`). Arrange certificate
validation before cutover, for example DNS validation when the old origin still
owns HTTP traffic; confirm renewal is configured in Plesk. Do not treat tests
with `curl -k` or ignored browser TLS errors as certificate verification.

Validate Nginx and test the new origin without changing public DNS:

```sh
sudo nginx -t
curl --fail --resolve karaoke.puyu.pe:443:74.208.127.50 https://karaoke.puyu.pe/
```

At cutover, replace the old tunnel CNAME with the production A record
`karaoke → 74.208.127.50` (DNS-only at the original launch). Check for conflicting
AAAA/CNAME records. Development instead uses the proxied tunnel CNAME described
in [the development tunnel guide](../odd/tasks/cloudflare-development-tunnel.md).
Do not repoint the production hostname to the development tunnel.

## 5. Enable subsequent Git deployments

In **Plesk → Git → Repository Settings**, enable additional deployment actions:

```sh
bash /var/www/vhosts/karaoke.puyu.pe/httpdocs/config/production-deploy.sh
```

Equivalent administrator command for the existing repository:

```sh
sudo plesk ext git --update -domain karaoke.puyu.pe -name KaraokeEternal.git \
  -run-actions true -actions "bash /var/www/vhosts/karaoke.puyu.pe/httpdocs/config/production-deploy.sh"
```

The script locks deployments, copies sources to a new release, installs with
`npm ci --include=dev`, typechecks, compiles with `--noEmitOnError`, copies SQL
schemas, and builds the frontend. It checks for missing applied migration IDs,
backs up SQLite, atomically switches `karaoke-current`, restarts, and polls `/`.
A build failure leaves the old release selected. A failed post-restart HTTP
check stops the service; there is **no automatic rollback**.

Push to the configured branch and use Plesk's Pull Updates/Deploy, or configure
the repository's private webhook in the Git provider for automatic pulls.
Do not publish webhook URLs in documentation. Publishing files alone does not
prove the deployment action completed: inspect its output and active service.

## Verification and operation

```sh
# As karaoke:
readlink "$HOME/karaoke-current"
systemctl show karaoke.service -p ActiveState -p NRestarts
ss -ltn 'sport = :3010'
curl --fail http://127.0.0.1:3010/
curl --fail 'http://127.0.0.1:3010/socket.io/?EIO=4&transport=polling'
# As administrator:
sudo journalctl -u karaoke.service -n 80 --no-pager
```

Verify public HTTPS in a browser, login, table QR entry, Socket.IO/WebSocket,
media loading and an operator-approved real playback. Automated fixtures stay
on isolated databases, not the public production room. The script's HTTP check
does not cover these flows. Preserve development `no-store` and hashed bundles.

## Backups and recovery

For an additional **database-only** online snapshot as `karaoke`:

```sh
python3 "$HOME/httpdocs/config/production-backup.py" \
  "$HOME/karaoke-data/database.sqlite3" \
  "$HOME/backups/manual-$(date -u +%Y%m%dT%H%M%SZ).sqlite3"
```

The helper uses SQLite's backup API, checks integrity, publishes a standalone
mode-600 file and prints its SHA256. It refuses existing destinations and cleans
up failed snapshots. Its parent directory must already exist. `--timeout`
bounds backup retries; integrity checking is performed afterward.

For disaster recovery, also back up the complete resource directory and `.env`
into private/off-host storage. Pause writes for a coherent database/resources
pair. Deployment snapshots cover SQLite only; they are not full-site backups.

To recover from a failed release, stop the service and preserve the failed
state first. Select a known-good release **together with compatible data**.
Do not simply point old code at a newer database: the application's down
migrations can remove data. If restoring a snapshot, account for orders and
uploads created afterward, restore into a clean data directory, verify integrity
and permissions, and then start and repeat the checks above. Avoid automatic
snapshot restoration that silently discards post-backup writes.

No release/backup retention job is installed. Monitor disk usage and remove old
artifacts only after identifying the active release and retained recovery pairs.
The initial deployment audit reported dependency advisories; upgrading them is
a separate tested code change, not an automatic `npm audit fix` on the VPS.
