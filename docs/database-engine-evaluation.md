# Database engine evaluation for production

## Decision

Keep **SQLite** for the current single-server production deployment. If Karaoke
Eternal evolves into a centralized platform with multiple application instances
or sustained concurrent writers, migrate to **PostgreSQL**.

Changing the engine is not currently a configuration switch. The application,
schema migrations, SQL dialect, backup process and tests are coupled to SQLite.
A PostgreSQL move must therefore be treated as a cross-cutting migration with a
data cutover and operational rollback plan.

## Current fit

The production topology is one persistent Node process on one VPS, with the
database stored beside persistent application resources. This is a valid SQLite
deployment model: clients call the application API rather than opening database
connections, writes are coordinated by one process, and WAL mode allows readers
to continue while a write is active.

SQLite still permits only one writer at a time. That is acceptable while write
transactions remain short and measured lock contention stays low. User count or
HTTP traffic alone is not evidence that the engine must change.

| Current requirement | SQLite assessment |
| --- | --- |
| One application instance | Good fit |
| Local database file on the VPS | Good fit |
| Transactional queue coordination | Supported; transactions are serialized |
| Online reads during writes | Supported through WAL |
| Simple backup and restore | Existing snapshot workflow already supports it |
| Multiple simultaneous writer processes | Limited to one active writer |
| Horizontal application scaling | Poor fit without additional coordination |

## Application coupling

The following contracts prevent replacing SQLite through an environment value:

| Area | Current dependency |
| --- | --- |
| Driver | `server/lib/Database.ts` imports synchronous `node:sqlite` and constructs `DatabaseSync` directly. |
| Location | `server/main.ts` opens `database.sqlite3` inside `KES_PATH_DATA`. |
| Runtime API | Callers depend on synchronous `db.get`, `db.all`, `db.run` and `db.exec` methods. |
| Transactions | Queue and coordination flows use `BEGIN IMMEDIATE`, savepoints and SQLite pragmas. |
| SQL dialect | Queries use `INSERT OR IGNORE`, `REPLACE INTO`, `AUTOINCREMENT` and `COLLATE NOCASE`. |
| JSON operations | Preferences, rooms and animation use `json_set`, `json_extract`, `json_each` and SQLite JSON semantics. |
| Migrations | The custom migration runner performs `PRAGMA table_info` checks and executes SQLite SQL files. |
| Operations | Deployment validation, snapshots, integrity checks and recovery procedures target a SQLite file and WAL lifecycle. |
| Tests | Unit and E2E fixtures create temporary SQLite databases and assert SQLite-specific behavior. |

DBHub support for another engine does not make the application engine-agnostic.
DBHub is an administrative gateway and does not translate application SQL or
replace its database driver.

## PostgreSQL as the migration target

PostgreSQL is the preferred client/server engine if the deployment outgrows
SQLite. It provides MVCC, multiple concurrent writers, row-level coordination,
strong operational tooling and JSONB with index support. These capabilities fit
a future centralized service better than replacing SQLite with another
file-based engine or choosing MySQL only because Plesk can provision it.

PostgreSQL becomes justified when evidence shows one or more of these needs:

- Multiple backend instances must write the same database.
- Distinct workers or services require independent database connections and
  sustained concurrent writes.
- Production metrics show recurring lock waits, `SQLITE_BUSY` failures or write
  latency caused by serialization after transactions have been optimized.
- Replication, point-in-time recovery, managed failover or centralized analytics
  become operational requirements.
- Multiple venues must share a central transactional data store rather than run
  isolated installations.

A database migration alone will not make the application horizontally scalable.
Some ownership, playback and job state is held in process memory, and Socket.IO
coordination assumes the current server topology. Those boundaries must be
designed alongside PostgreSQL adoption.

## Migration scope

1. Define an asynchronous database contract and remove direct dependence on
   `DatabaseSync` without introducing two permanent SQL dialects by accident.
2. Translate the schema and migration history to PostgreSQL types, constraints,
   identity columns, conflict clauses, collations and JSONB operations.
3. Rework queue and coordination transactions with explicit PostgreSQL locking
   semantics, then prove the same fairness and ownership invariants.
4. Adapt all database callers to asynchronous I/O and verify error propagation,
   transaction boundaries and shutdown behavior.
5. Build a repeatable SQLite-to-PostgreSQL data transfer that preserves IDs,
   foreign keys, JSON values, timestamps and migration state.
6. Validate the transferred database against application-level counts and
   invariants before cutover; rehearse rollback with a write freeze.
7. Replace SQLite snapshot, integrity and WAL procedures with PostgreSQL backup,
   restore, monitoring and credential rotation procedures.
8. Run focused queue, authentication, room, animation and recovery tests plus a
   complete production rehearsal before switching the live service.

## Review triggers

Revisit this decision when deployment topology or measured workload changes.
Before approving a migration, collect at least:

- Peak writes per second and write transaction duration.
- Lock wait, busy-error and database latency observations.
- Database size and growth rate.
- Required recovery point and recovery time objectives.
- Number of application instances and background writer processes planned.
- Whether venues require shared data or operational isolation.

Without that evidence, moving to PostgreSQL would add service administration,
network failure modes and migration risk without proving a production benefit.

## References

- [SQLite: Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- [SQLite: Write-Ahead Logging](https://www.sqlite.org/wal.html)
- [PostgreSQL: Concurrency Control](https://www.postgresql.org/docs/current/mvcc-intro.html)
- [PostgreSQL: JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [Production deployment](production-deployment.md)
- [Database tools](database-tools.md)
