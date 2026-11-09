#!/usr/bin/env python3
"""Create an integrity-checked SQLite snapshot without replacing existing files."""

import argparse
from contextlib import closing
import hashlib
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import time


def backup_database(source, destination, timeout=60.0):
    source = Path(source).expanduser().resolve(strict=True)
    destination = Path(destination).expanduser().absolute()
    if not source.is_file():
        raise ValueError('Source must be a database file')
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f'Destination already exists: {destination}')
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Timeout must be finite and positive')
    deadline = time.monotonic() + timeout

    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError('SQLite backup exceeded its time limit')

    # Keep the temporary snapshot on the destination filesystem for atomic publication.
    with tempfile.TemporaryDirectory(prefix='.sqlite-backup-', dir=destination.parent) as work:
        snapshot = Path(work) / 'snapshot.sqlite3'
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(snapshot)) as copy:
                original.backup(copy, pages=256, progress=progress)
                if copy.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise ValueError('SQLite integrity check failed')
                # Publish a standalone file, without depending on WAL sidecars.
                copy.execute('PRAGMA journal_mode=DELETE')
        os.chmod(snapshot, 0o600)
        digest = hashlib.sha256()
        with snapshot.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
            os.fsync(stream.fileno())
        # Unlike replace(), link() refuses to overwrite a destination created concurrently.
        os.link(snapshot, destination)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path, help='New file in an existing private directory')
    parser.add_argument('--timeout', type=float, default=60, help='Backup timeout in seconds (default: 60)')
    args = parser.parse_args()
    try:
        checksum = backup_database(args.source, args.destination, args.timeout)
    except (OSError, ValueError, sqlite3.Error) as error:
        parser.exit(1, f'Backup failed: {error}\n')
    print(f'Integrity: ok\nSHA256: {checksum}\nSnapshot: {args.destination}')


if __name__ == '__main__':
    main()
