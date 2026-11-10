import path from 'path'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite' // eslint-disable-line n/no-unsupported-features/node-builtins
import getLogger from './Log.js'
import { defaultModeration, setModerationTerms, validateModeration } from '../../shared/textModeration.js'

type SqlParam = string | number | bigint | null | Uint8Array

const log = getLogger('db')

export let db: DatabaseWrapper

export class DatabaseWrapper {
  private db: DatabaseSync
  public config: { filename: string }

  constructor (file: string) {
    this.config = { filename: file }
    this.db = new DatabaseSync(file)
  }

  close () {
    this.db.close()
  }

  all<T = unknown> (sql: string, params: unknown[] | Record<string, unknown> = []) {
    const stmt = this.db.prepare(sql)
    let res

    if (Array.isArray(params)) {
      res = stmt.all(...(params as SqlParam[]))
    } else {
      res = stmt.all(params as Record<string, SqlParam>)
    }

    return res as T[]
  }

  run (sql: string, params: unknown[] | Record<string, unknown> = []) {
    const stmt = this.db.prepare(sql)
    let res

    if (Array.isArray(params)) {
      res = stmt.run(...(params as SqlParam[]))
    } else {
      res = stmt.run(params as Record<string, SqlParam>)
    }

    return {
      lastID: res.lastInsertRowid,
      changes: res.changes,
    }
  }

  get<T = unknown> (sql: string, params: unknown[] | Record<string, unknown> = []) {
    const stmt = this.db.prepare(sql)
    let res

    if (Array.isArray(params)) {
      res = stmt.get(...(params as SqlParam[]))
    } else {
      res = stmt.get(params as Record<string, SqlParam>)
    }

    return res as T | undefined
  }

  exec (sql: string) {
    this.db.exec(sql)
  }

  migrate ({ migrationsPath, force = false, table = 'migrations' }: { migrationsPath: string, force?: boolean, table?: string }) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (
      id INTEGER PRIMARY KEY,
      name TEXT,
      up TEXT,
      down TEXT
    )`)

    const files = fs.readdirSync(migrationsPath)
    const migrations = []

    for (const file of files) {
      const match = file.match(/^(\d+)-(.*)\.sql$/)

      if (match) {
        const content = fs.readFileSync(path.join(migrationsPath, file), 'utf8')
        const parts = content.split(/^--\s*Down/mi)
        const upSql = parts[0].replace(/^--\s*Up/mi, '').trim()
        const downSql = (parts[1] || '').trim()

        migrations.push({
          id: parseInt(match[1], 10),
          name: match[2],
          up: upSql,
          down: downSql,
        })
      }
    }

    migrations.sort((a, b) => a.id - b.id)

    let dbMigrations = this.all<{ id: number, name: string, up: string, down: string }>(
      `SELECT id, name, up, down FROM "${table}" ORDER BY id ASC`,
    )

    const lastMigration = migrations[migrations.length - 1]

    for (const migration of [...dbMigrations].sort((a, b) => b.id - a.id)) {
      if (
        !migrations.some(x => x.id === migration.id)
        || (force && lastMigration && migration.id === lastMigration.id)
      ) {
        log.info('Running down migration %s: %s', migration.id, migration.name)
        this.exec('BEGIN')
        try {
          this.exec(migration.down)
          this.run(`DELETE FROM "${table}" WHERE id = ?`, [migration.id])
          this.exec('COMMIT')
          dbMigrations = dbMigrations.filter(x => x.id !== migration.id)
        } catch (err) {
          this.exec('ROLLBACK')
          throw err
        }
      } else {
        break
      }
    }

    // Parallel features can introduce a missing version below the latest applied ID.
    const appliedIds = new Set(dbMigrations.map(migration => migration.id))

    for (const migration of migrations) {
      if (!appliedIds.has(migration.id)) {
        log.info('Running migration %s: %s', migration.id, migration.name)
        // SQLite requires foreign keys to be disabled outside the transaction
        // when replacing a referenced table. Validate every reference before commit.
        const rebuild = /^-- Rebuild referenced tables[ \t]*$/m.test(migration.up)
        const foreignKeys = rebuild ? this.get<{ foreign_keys: number }>('PRAGMA foreign_keys')!.foreign_keys : 0
        if (rebuild) this.exec('PRAGMA foreign_keys = OFF')
        this.exec('BEGIN')
        try {
          // Compatibility migrations can cover databases that received an earlier
          // revision of an unreleased schema without rewriting migration history.
          const missingColumn = migration.up.match(/^-- If column missing: ([A-Za-z_]\w*)\.([A-Za-z_]\w*)[ \t]*$/m)
          const hasColumn = missingColumn && this.all<{ name: string }>(`PRAGMA table_info("${missingColumn[1]}")`)
            .some(column => column.name === missingColumn[2])
          if (!hasColumn) this.exec(migration.up)
          if (rebuild && this.all('PRAGMA foreign_key_check').length) throw new Error(`Migration ${migration.id} would break foreign keys`)
          this.run(
            `INSERT INTO "${table}" (id, name, up, down) VALUES (?, ?, ?, ?)`,
            [migration.id, migration.name, migration.up, migration.down || null],
          )
          this.exec('COMMIT')
        } catch (err) {
          this.exec('ROLLBACK')
          throw err
        } finally {
          if (rebuild) this.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
        }
      }
    }
  }
}

class Database {
  static refs: { db?: DatabaseWrapper } = {}

  static close () {
    if (Database.refs.db) {
      log.info('Closing database file %s', Database.refs.db.config.filename)
      Database.refs.db.close()
      delete Database.refs.db
      setModerationTerms(defaultModeration.terms)
    }
  }

  static open ({ file, ro = true }: { file: string, ro?: boolean } = { file: '', ro: true }) {
    if (Database.refs.db) throw new Error('Database already open')
    log.info('Opening database file %s %s', ro ? '(read-only)' : '(writeable)', file)

    // create path if it doesn't exist
    fs.mkdirSync(path.dirname(file), { recursive: true })

    const instance = new DatabaseWrapper(file)

    if (!ro) {
      instance.migrate({
        migrationsPath: path.join(import.meta.dirname, 'schemas'),
      })

      instance.exec('PRAGMA journal_mode = WAL;')
      instance.exec('PRAGMA foreign_keys = ON;')
    }

    Database.refs.db = instance
    db = instance
    const moderation = instance.get<{ data: string }>('SELECT data FROM prefs WHERE key=?', ['moderation'])
    setModerationTerms(moderation ? validateModeration(JSON.parse(moderation.data)).terms : defaultModeration.terms)
    return instance
  }
}

export const open = Database.open
export const close = Database.close

export default Database.refs
