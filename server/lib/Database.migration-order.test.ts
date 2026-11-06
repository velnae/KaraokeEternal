import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DatabaseWrapper } from './Database.js'

it('applies newly introduced migration gaps without replaying already applied versions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-order-'))
  const database = new DatabaseWrapper(':memory:')
  try {
    fs.writeFileSync(path.join(directory, '001-base.sql'), `-- Up
CREATE TABLE preserved (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO preserved VALUES(1,40);
-- Down
DROP TABLE preserved;
`)
    fs.writeFileSync(path.join(directory, '003-existing.sql'), `-- Up
UPDATE preserved SET value=value+2;
-- Down
UPDATE preserved SET value=value-2;
`)
    database.migrate({ migrationsPath: directory })
    expect(database.get('SELECT value FROM preserved WHERE id=1')).toEqual({ value: 42 })

    fs.writeFileSync(path.join(directory, '002-late-feature.sql'), `-- Up
ALTER TABLE preserved ADD COLUMN label TEXT NOT NULL DEFAULT 'kept';
-- Down
ALTER TABLE preserved DROP COLUMN label;
`)
    fs.writeFileSync(path.join(directory, '004-dependent.sql'), `-- Up
CREATE TABLE dependent AS SELECT id,label FROM preserved;
-- Down
DROP TABLE dependent;
`)
    database.migrate({ migrationsPath: directory })
    database.migrate({ migrationsPath: directory })
    expect(database.get('SELECT * FROM preserved WHERE id=1')).toEqual({ id: 1, value: 42, label: 'kept' })
    expect(database.get('SELECT * FROM dependent')).toEqual({ id: 1, label: 'kept' })
    expect(database.all<{ id: number }>('SELECT id FROM migrations ORDER BY id').map(row => row.id)).toEqual([1, 2, 3, 4])
  } finally {
    database.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
