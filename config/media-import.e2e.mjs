import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { request } from 'playwright'
import { prepare, readJSON, writeJSON } from './media-import.js'
import { upload } from './media-import-api.js'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'media-import-e2e-'))
const log = openSync(path.join(directory, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const baseUrl = `http://127.0.0.1:${port}/karaoke/`
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--data', directory, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', log, log],
  env: { ...process.env, NODE_ENV: 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
})
const api = await request.newContext()
let db
const wait = async (predicate) => {
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw new Error(`Server stopped. See ${directory}/server.log`)
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Wait timed out. See ${directory}/server.log`)
}
const call = async (suffix, data, method = data === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${baseUrl}api/${suffix}`, { method, data })
  assert.ok(response.ok(), `${suffix}: ${response.status()} ${await response.text()}`)
  return response.json()
}

try {
  await wait(async () => {
    try {
      return (await api.get(`${baseUrl}api/prefs`)).ok()
    } catch { return false }
  })
  await call('setup', { username: 'admin', name: 'Importer', newPassword: 'import-test-password', newPasswordConfirm: 'import-test-password' })
  await call('login', { username: 'admin', password: 'import-test-password', roomId: 1 })
  const storageState = await api.storageState()
  const sourceFile = path.join(directory, 'source.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', sourceFile])
  const input = { sourceFile, title: 'Imported fixture', destination: 'audio', kind: 'effect', roomId: 1, start: 0.5, end: 1.5, baseUrl }
  const prepared = await prepare(input, directory)
  await assert.rejects(upload(prepared.receiptPath, { storageState: { cookies: [], origins: [] } }), /HTTP 401/)
  const wrong = await prepare({ ...input, roomId: 2 }, directory)
  await assert.rejects(upload(wrong.receiptPath, { storageState }), /expected room/)
  const first = await upload(prepared.receiptPath, { storageState })
  assert.equal(first.status, 'verified')
  assert.equal(first.resource.kind, 'effect')
  assert.equal(first.resource.state, 'active')
  assert.equal((await upload(prepared.receiptPath, { storageState })).resourceId, first.resourceId)
  // Simulate an accepted upload whose response/receipt update was lost.
  await writeJSON(prepared.receiptPath, { ...prepared, status: 'uploading' })
  assert.equal((await upload(prepared.receiptPath, { storageState })).resourceId, first.resourceId)

  const background = await prepare({ ...input, destination: 'background' }, directory)
  const selectedBefore = (await call('animation/background/')).settings
  const video = await upload(background.receiptPath, { storageState })
  assert.equal(video.status, 'verified')
  assert.deepEqual((await call('animation/background/')).settings, selectedBefore)
  await writeJSON(background.receiptPath, { ...background, status: 'uploading' })
  assert.equal((await upload(background.receiptPath, { storageState })).resourceId, video.resourceId)

  const silent = path.join(directory, 'silent.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc', '-t', '2', silent])
  const failed = await prepare({ ...input, sourceFile: silent, title: 'Silent fixture' }, directory)
  await assert.rejects(upload(failed.receiptPath, { storageState }), /failed/)
  const failedId = (await readJSON(failed.receiptPath)).resourceId
  await assert.rejects(upload(failed.receiptPath, { storageState }), /failed/)
  assert.equal((await readJSON(failed.receiptPath)).resourceId, failedId)

  const libraryPath = path.join(directory, 'library')
  await fs.mkdir(libraryPath)
  const prefs = await call(`prefs/path?dir=${encodeURIComponent(libraryPath)}`, {})
  const pathId = Number(prefs.paths.result[0])
  const library = await prepare({ ...input, destination: 'library', artist: 'Fixture Artist', pathId, libraryPath }, directory)
  const copied = await upload(library.receiptPath, { storageState })
  assert.equal(copied.status, 'scan-requested')
  db = new DatabaseSync(path.join(directory, 'database.sqlite3'), { readOnly: true })
  await wait(async () => db.prepare('SELECT COUNT(*) AS n FROM media WHERE pathId=?').get(pathId).n === 1)
  const row = db.prepare('SELECT * FROM media WHERE pathId=?').get(pathId)
  assert.equal(db.prepare('SELECT title FROM songs WHERE songId=?').get(row.songId).title, input.title)
  assert.equal((await upload(library.receiptPath, { storageState })).targetFile, copied.targetFile)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media WHERE pathId=?').get(pathId).n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM animationInterventions').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM queue').get().n, 0)
  console.log(`PASS real API: audio/background/library imports, checksums, session/room rejection, failed preparation, retries without duplicates, unchanged selection and queue. Artifacts: ${directory}`)
} finally {
  db?.close()
  await api.dispose()
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
  }
  closeSync(log)
}
