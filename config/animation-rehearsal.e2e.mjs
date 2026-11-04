import { chromium, request, expect } from 'playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = process.env.KARAOKE_REHEARSAL_DATA
assert.ok(sourceRoot, 'Set KARAOKE_REHEARSAL_DATA to the existing karaoke data directory.')
const sourceRoom = Number(process.env.KARAOKE_REHEARSAL_ROOM || 1)
const development = process.env.KARAOKE_E2E_MODE === 'development'
const audible = process.env.KARAOKE_REHEARSAL_AUDIBLE === '1'
const source = new DatabaseSync(path.join(sourceRoot, 'database.sqlite3'), { readOnly: true })
const resources = source.prepare(`SELECT * FROM audioResources WHERE roomId=? AND state='active' AND preparation='ready' AND deletedAt IS NULL`).all(sourceRoom)
source.close()
const voices = ['welcome', 'turn', 'closing', 'invitation', 'celebration', 'goodbye']
for (const family of voices) assert.ok(resources.some(row => row.kind === 'voice' && JSON.parse(row.metadataJSON).family === family), `Missing ready voice: ${family}`)
for (const category of ['appreciation', 'celebration']) assert.ok(resources.some(row => row.kind === 'effect' && JSON.parse(row.metadataJSON).category === category), `Missing effect: ${category}`)
const ambient = resources.find(row => row.kind === 'ambience' && JSON.parse(row.metadataJSON).loop === true)
assert.ok(ambient, 'Provide one approved looping ambience for the rehearsal.')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-real-rehearsal-'))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const api = await request.newContext()
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const checks = []
const errors = []
let server, browser, socket, db, player
const check = (situation, evidence) => {
  checks.push({ situation, result: 'PASS', evidence })
  console.log(`PASS ${situation}`)
}
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${origin}/api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const reply = await socket.timeout(4000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 3000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}
const control = async (patch) => {
  const state = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { ...patch, controlVersion: state.controlVersion })
}
const history = family => db.prepare('SELECT * FROM animationInterventions WHERE family=? ORDER BY rowid').all(family)
const waitFor = async (family, count) => {
  await expect.poll(() => history(family).filter(row => row.status === 'PLAYED').length, { timeout: 30000 }).toBe(count)
  return history(family).at(-1)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const ended = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await ended
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', data, '--port', String(port), '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${origin}/api/prefs`)).ok) return
    } catch { /* Wait for startup. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Rehearsal server did not start')
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '4', '-af', 'volume=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'track.mp4')])
  await start()
  await call('setup', { username: 'operator', newPassword: 'rehearsal-only-password', newPasswordConfirm: 'rehearsal-only-password', name: 'Rehearsal operator' })
  await stop()
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  for (const resource of resources) {
    const from = path.resolve(sourceRoot, 'animation', resource.filename)
    assert.ok(from.startsWith(path.resolve(sourceRoot, 'animation') + path.sep))
    const to = path.join(data, 'animation', resource.filename)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    const row = { ...resource, roomId: 1, state: 'active' }
    db.prepare(`INSERT INTO audioResources(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
  }
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Rehearsal\',\'rehearsal\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Rehearsal track\',\'rehearsal track\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'track.mp4\',4,1)')
  await start()
  await call('login', { username: 'operator', password: 'rehearsal-only-password', roomId: 1 })
  const cookie = (await api.storageState()).cookies.map(row => `${row.name}=${row.value}`).join('; ')
  socket = io(origin, { extraHeaders: { cookie }, transports: ['websocket'], autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: !audible, ...(audible ? { ignoreDefaultArgs: ['--mute-audio'] } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await context.addInitScript(() => {
    window.rehearsalAudio = []
    const buffers = new WeakMap()
    const entries = new WeakMap()
    const active = new Set()
    const disconnect = AudioNode.prototype.disconnect
    AudioNode.prototype.disconnect = function (...args) {
      active.delete(this)
      const entry = entries.get(this)
      if (entry && entry.endedAt === null) entry.endedAt = performance.now()
      return disconnect.apply(this, args)
    }
    const decode = BaseAudioContext.prototype.decodeAudioData
    BaseAudioContext.prototype.decodeAudioData = async function (bytes) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(0)))].map(value => value.toString(16).padStart(2, '0')).join('')
      const buffer = await decode.call(this, bytes)
      buffers.set(buffer, hash)
      return buffer
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      const video = document.querySelector('video:not([data-media-role="transition-background"])')
      const entry = { checksum: buffers.get(this.buffer), duration: this.buffer.duration, loop: this.loop, startedAt: performance.now(), endedAt: null,
        overlap: [...active].some(source => source.context.state === 'running'), music: !!video && !video.paused && !video.ended }
      window.rehearsalAudio.push(entry)
      entries.set(this, entry)
      active.add(this)
      this.addEventListener('ended', () => {
        if (entry.endedAt === null) entry.endedAt = performance.now()
        active.delete(this)
      })
      return start.apply(this, args)
    }
  })
  await control({ enabled: true, automation: true, profile: 'mixed', ambienceEnabled: true, volume: 0.5, ambienceVolume: 0.2,
    events: { welcome: true, turn: true, closing: true, invitation: true, celebration: true, goodbye: true, booth: true, promotion: true } })
  player = await context.newPage()
  await player.goto(`${origin}/account?roomId=1`)
  await player.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await player.getByPlaceholder('nombre de usuario o correo electrónico').fill('operator')
  await player.getByPlaceholder('contraseña', { exact: true }).fill('rehearsal-only-password')
  await player.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(player.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await player.goto(`${origin}/player`)
  await player.getByRole('toolbar', { name: 'Controles de reproducción' }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await emit('server/ANIMATION_SESSION', { operation: 'open' })
  const welcome = await waitFor('welcome', 1)
  check('Welcome uses the prepared real voice once', welcome.clipId)
  const beds = resources.filter(row => row.kind === 'ambience')
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience !== null).toBe(true)
  await player.waitForTimeout(beds.length > 1 ? beds.reduce((sum, row) => sum + row.durationMs, 0) + 2000 : 35000)
  const heardBeds = await player.evaluate(() => window.rehearsalAudio.map(row => row.checksum))
  for (const bed of beds) assert.ok(heardBeds.includes(bed.checksum), `${bed.title} must enter automatic rotation`)
  check('Available ambience rotates automatically, including non-looping files', beds.map(row => row.title))
  const addSong = () => emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  for (let i = 0; i < 12; i++) await addSong()
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYED\'').get().n, { timeout: 200000 }).toBe(12)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.active, { timeout: 30000 }).toBeNull()
  for (const family of ['turn', 'closing', 'celebration']) assert.ok(history(family).filter(row => row.status === 'PLAYED').length >= 2, `${family} must recover and repeat without operator requests`)
  check('Twelve songs autonomously rotate presentations, closings and generic celebrations', Object.fromEntries(['turn', 'closing', 'celebration'].map(family => [family, history(family).length])))
  const used = db.prepare('SELECT DISTINCT clipId FROM audioUsage').all().map(row => row.clipId)
  for (const resource of resources.filter(row => row.kind === 'effect')) assert.ok(used.includes(resource.id), `${resource.title} must receive an automatic placement`)
  check('Both applause categories, anticipation and all available separators receive automatic placements', resources.filter(row => row.kind === 'effect').map(row => row.title))
  assert.ok(history('turn').some((row, index, rows) => rows.findIndex(other => other.clipId === row.clipId) !== index))
  check('A single presentation can be reused after cooldown rather than staying blocked', history('turn').map(row => row.clipId))
  // Age only isolated history to exercise successive twelve-minute program windows.
  const seen = { invitation: 0, booth: 0, promotion: 0 }
  for (const family of ['invitation', 'booth', 'promotion', 'invitation']) {
    const advance = 13 * 60000
    db.prepare('UPDATE animationSessions SET openedAt=openedAt-? WHERE status=\'OPEN\'').run(advance)
    db.prepare('UPDATE animationInterventions SET startedAt=startedAt-?,finishedAt=finishedAt-? WHERE startedAt IS NOT NULL').run(advance, advance)
    db.prepare('UPDATE audioUsage SET startedAt=startedAt-?').run(advance)
    await waitFor(family, ++seen[family])
  }
  check('Invitations, booth messages and valid promotions rotate and remain reusable', { seen, intervalsAdvancedOnlyInFixture: true })
  await emit('server/ANIMATION_SESSION', { operation: 'close' })
  const farewell = await waitFor('goodbye', 1)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.session).toBeNull()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience).toBeNull()
  check('Explicit close speaks the farewell and ends ambience', farewell.clipId)
  const trace = await player.evaluate(() => window.rehearsalAudio)
  assert.ok(trace.every(row => !row.overlap && !row.music))
  assert.equal(db.prepare('SELECT count(*) n FROM catalogGenerationJobs').get().n, 0)
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(data, 'report.json'), JSON.stringify({ mode: development ? 'development' : 'production', audible, checks, trace,
    sources: resources.map(({ id, title, kind, checksum, durationMs }) => ({ id, title, kind, checksum, durationMs })), manualListening: 'Pending operator acceptance', music: 'Local synthetic test track', providerCalls: 0 }, null, 2))
  await player.screenshot({ path: path.join(data, 'finished.png') })
  console.log(`Real-catalog rehearsal passed. Evidence: ${data}`)
} catch (error) {
  console.error(`Rehearsal evidence: ${data}`, errors)
  if (player && !player.isClosed()) {
    await player.screenshot({ path: path.join(data, 'failure.png') }).catch(() => {})
    console.error(await player.locator('body').innerText().catch(() => 'unavailable'))
    fs.writeFileSync(path.join(data, 'trace-failure.json'), JSON.stringify(await player.evaluate(() => window.rehearsalAudio).catch(() => []), null, 2))
  }
  throw error
} finally {
  socket?.disconnect()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
