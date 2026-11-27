import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'

// Focused contract: one full applause crosses countdown -> YouTube without
// releasing its finite permit early; cancelling the countdown stops it instead.
const root = path.resolve(import.meta.dirname, '..')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-applause-handoff-'))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const uiBase = process.env.KARAOKE_E2E_HTTPS_UI === '1' ? 'https://dev-karaoke.puyu.pe/' : base
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const api = await request.newContext()
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(base + 'api/' + suffix, { method, data: body })
  assert.ok(response.ok(), `${suffix}: ${response.status()} ${await response.text()}`)
  return response.json()
}
let server, browser, socket, db, page
const start = async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--data', data, '--port', String(port), '--urlPath', '/karaoke/'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: 'development', KES_SCAN: '', KES_GEMINI_API_KEY: '', KES_ELEVENLABS_API_KEY: '',
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/karaoke-webpack.mjs')).href}` },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${data}`)
    try {
      return (await api.get(base + 'api/prefs')).status()
    } catch { return 0 }
  }, { timeout: 120000 }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const ended = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await ended
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(5000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 4000 } })
  assert.ok(!response.error, response.error)
  return response
}
try {
  const wave = path.join(data, 'applause.wav')
  const video = path.join(data, 'youtube-fixture.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100', '-t', '6', wave])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '20', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'applause-fixture', newPasswordConfirm: 'applause-fixture' })
  await stop()
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec(`UPDATE rooms SET status='open' WHERE roomId=1;
    INSERT INTO karaokeCallControls(roomId,enabled,automaticStart) VALUES(1,1,0);
    INSERT INTO queue(queueId,roomId,userId,origin,requestIntent,status,source,externalId,title,artistOrChannel)
      VALUES(1,1,1,'PARTICIPANT','SING','APPROVED','YOUTUBE','fixture0001','Fixture karaoke','Fixture');`)
  await start()
  await call('login', { username: 'admin', password: 'applause-fixture', roomId: 1 })
  const upload = await api.post(base + 'api/rooms/1/karaoke-calls/backgrounds/upload', { multipart: {
    kind: 'effect', requestId: 'six-second-applause', file: { name: 'Applause.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(wave) },
  } })
  assert.equal(upload.status(), 202, await upload.text())
  const asset = await upload.json()
  assert.equal(asset.state, 'ready', asset.error)
  assert.equal(asset.durationMs, 6000)
  const settings = (await call('rooms/1/karaoke-calls/backgrounds')).settings
  await call('rooms/1/karaoke-calls/backgrounds', { ...settings, countdownEffectId: asset.id, endedEffectId: asset.id }, 'PUT')
  const cookie = (await api.storageState()).cookies.map(item => `${item.name}=${item.value}`).join('; ')
  socket = io(new URL(base).origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie } })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const context = await browser.newContext({ storageState: await api.storageState() })
  if (uiBase !== base) {
    await context.route('https://dev-karaoke.puyu.pe/api/**', async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      try {
        const response = await api.fetch(base + 'api/' + url.pathname.split('/api/')[1] + url.search,
          { method: incoming.method(), data: incoming.postDataBuffer() ?? undefined, headers: { 'content-type': incoming.headers()['content-type'] ?? 'application/json', 'accept-encoding': 'identity' } })
        await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    })
    await context.route('https://dev-karaoke.puyu.pe/socket.io/**', async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      try {
        const response = await api.fetch(base + 'socket.io/' + url.search, { method: incoming.method(), data: incoming.postDataBuffer() ?? undefined,
          headers: { 'content-type': incoming.headers()['content-type'] ?? 'text/plain', 'accept-encoding': 'identity' } })
        if (incoming.method() === 'GET' && !url.searchParams.has('sid')) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    })
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  await installYouTubeTransitionFixture(context, video)
  // A cold effect takes a substantial part of the countdown to download.
  await context.route(`**/karaoke-calls/backgrounds/assets/${asset.id}`, async (route) => {
    await new Promise(resolve => setTimeout(resolve, 1600))
    await route.fallback()
  })
  await context.addInitScript(() => {
    window.applauseRuns = []
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this)
      const start = source.start.bind(source)
      source.start = (...args) => {
        const run = { at: performance.now(), audioAt: source.context.currentTime, duration: source.buffer.duration, endedAt: null, audioEnd: null }
        window.applauseRuns.push(run)
        source.addEventListener('ended', () => {
          run.endedAt = performance.now()
          run.audioEnd = source.context.currentTime
        })
        return start(...args)
      }
      return source
    }
    document.addEventListener('playing', (event) => {
      if (event.target.tagName === 'VIDEO') window.musicAt = performance.now()
    }, true)
  })
  page = await context.newPage()
  await page.goto(uiBase + 'account?roomId=1', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('applause-fixture')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await page.goto(uiBase + 'player', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Reproducir', exact: true }).last().click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked, { timeout: 15000 }).toBe(true)
  const turn = () => db.prepare('SELECT * FROM karaokeStartTurns WHERE roomId=1').get()
  await expect.poll(() => turn()?.phase, { timeout: 15000 }).toBe('waiting')
  await emit('server/KARAOKE_TURN', { ...turn(), operation: 'start' })
  await page.waitForFunction(() => window.applauseRuns.length === 1)
  await emit('server/KARAOKE_TURN', { ...turn(), operation: 'cancel' })
  await page.waitForFunction(() => window.applauseRuns[0].endedAt !== null)
  assert.equal(await page.evaluate(() => window.musicAt ?? null), null)
  assert.ok(await page.evaluate(() => window.applauseRuns[0].audioEnd - window.applauseRuns[0].audioAt < 2))
  const before = Date.now()
  await emit('server/KARAOKE_TURN', { ...turn(), operation: 'start' })
  assert.ok(turn().endsAt - before >= 2900 && turn().endsAt - before < 3500, 'The countdown starts at three')
  const endsAt = turn().endsAt
  await page.waitForFunction(() => !!window.musicAt, undefined, { timeout: 10000 })
  await page.waitForFunction(() => !!window.applauseRuns[1]?.endedAt, undefined, { timeout: 10000 })
  const evidence = await page.evaluate(() => ({ runs: window.applauseRuns, musicAt: window.musicAt, trace: window.karaokePlaybackTrace.snapshot() }))
  const applause = evidence.runs[1]
  assert.ok(evidence.trace.timeOrigin + applause.at < endsAt, 'The native applause must start during its countdown')
  assert.ok(applause.audioEnd - applause.audioAt >= 5.9 && applause.audioEnd - applause.audioAt < 6.2, 'Complete six-second source')
  assert.ok(evidence.musicAt - applause.at > 2000 && evidence.musicAt - applause.at < 4500, 'Music starts after countdown, not after applause')
  assert.ok(applause.endedAt - evidence.musicAt > 1500, 'The applause tail overlaps native YouTube-fixture video playback')
  await expect.poll(() => db.prepare(`SELECT status FROM animationInterventions WHERE json_extract(karaokeCueJSON,'$.kind')='countdown' ORDER BY requestedAt DESC LIMIT 1`).get()?.status).toBe('PLAYED')
  fs.writeFileSync(path.join(data, 'handoff.json'), JSON.stringify({ result: 'PASS', fidelity: 'isolated YouTube component with local native-video API fixture, real WebAudio applause', asset, ...evidence }, null, 2))
  console.log(`PASS: countdown=3s, applause=${(applause.audioEnd - applause.audioAt).toFixed(3)}s, music overlap=${Math.round(applause.endedAt - evidence.musicAt)}ms; cancellation and persisted permit passed. Artifacts: ${data}`)
} catch (error) {
  console.error(`Applause handoff failed: ${error.message}. Artifacts: ${data}`)
  const state = await page?.evaluate(() => ({ url: location.href, text: document.body.innerText, runs: window.applauseRuns, musicAt: window.musicAt, trace: window.karaokePlaybackTrace?.snapshot() })).catch(() => null)
  fs.writeFileSync(path.join(data, 'failure.json'), JSON.stringify({ state, turns: db?.prepare('SELECT * FROM karaokeStartTurns').all(), cues: db?.prepare('SELECT status,reason,startedAt,finishedAt,karaokeCueJSON FROM animationInterventions').all() }, null, 2))
  throw error
} finally {
  socket?.close()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
