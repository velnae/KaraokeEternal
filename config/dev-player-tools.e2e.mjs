import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'

const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-player-tools-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
let server, browser, socket, db, player
const errors = []
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(5000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 4000 } })
  assert.ok(!response.error, response.error)
  return response
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '60', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--serverLogLevel', '0'], {
    cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: development ? 'development' : 'production', DEV_PLAYER_TOOLS: 'true',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_YOUTUBE_API_KEY: '', KES_ELEVENLABS_API_KEY: '', KES_GEMINI_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited; logs: ${data}`)
    return api.get(`${base}api/prefs`).then(response => response.status()).catch(() => 0)
  }, { timeout: 120000 }).toBe(200)
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'dev-tools-fixture', newPasswordConfirm: 'dev-tools-fixture' })
  await call('login', { username: 'admin', password: 'dev-tools-fixture', roomId: 1 })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  for (let index = 0; index < 2; index++) {
    db.prepare(`INSERT INTO queue(roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin)
      VALUES(1,1,(SELECT max(queueId) FROM queue),'YOUTUBE','fixture0001',?,'Fixture','OPERATOR')`).run(`Development song ${index + 1}`)
  }
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  // A prepared voice exercises intro → voice → next-song loading after natural end.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', path.join(data, 'voice.wav')])
  const uploaded = await api.post(`${base}api/animation/resources/upload`, { multipart: {
    requestId: 'dev-tools-voice', title: 'Development voice', kind: 'voice',
    metadata: JSON.stringify({ text: 'La próxima canción está lista.', family: 'turn', modes: ['mixed'] }),
    file: { name: 'voice.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(data, 'voice.wav')) },
  } })
  assert.equal(uploaded.status(), 200, await uploaded.text())
  const snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true,
    profile: 'mixed', events: { welcome: false, turn: true, closing: false, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
  await emit('server/ANIMATION_SESSION', { operation: 'open' })

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: await api.storageState() })
  if (httpsUi) {
    // Exercise the HTTPS frontend with only this temporary database and socket.
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const headers = { 'accept-encoding': 'identity' }
      for (const name of ['content-type', 'range', 'if-range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
      const response = await api.fetch(base + (socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`), {
        method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000,
      })
      if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
        const open = await response.text()
        assert.ok(open.startsWith('0'))
        const handshake = JSON.parse(open.slice(1))
        handshake.upgrades = []
        const responseHeaders = response.headers()
        delete responseHeaders['content-length']
        await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
      } else await route.fulfill({ response })
    }
    const safelyForward = async (route, socketTraffic = false) => {
      try {
        await forward(route, socketTraffic)
      } catch {
        if (player && !player.isClosed()) errors.push('Isolated API/socket forwarding failed')
        await route.abort('failed').catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => safelyForward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => safelyForward(route, true))
    await context.routeWebSocket('**/socket.io/**', connection => connection.close())
  }
  await installYouTubeTransitionFixture(context, path.join(data, 'song.mp4'))
  // Seeking requires byte-range responses, unlike the short play-through fixture.
  const songBytes = fs.readFileSync(path.join(data, 'song.mp4'))
  await context.route('**/transition-youtube.mp4', async (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), songBytes.length - 1) : songBytes.length - 1
    await route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
      headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${songBytes.length}` } : {}) },
      body: songBytes.subarray(start, end + 1) })
  })
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.YT.Player.prototype.getDuration = function () {
        return this.video.duration
      }
    })
    window.devToolPhases = []
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const phase = document.querySelector('[aria-label="Herramientas de desarrollo"] p')?.textContent
        if (phase && window.devToolPhases.at(-1) !== phase) window.devToolPhases.push(phase)
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
  })
  player = await context.newPage()
  player.on('pageerror', error => errors.push(error.message))
  await player.goto(`${uiBase}account?roomId=1`)
  await player.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await player.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await player.getByPlaceholder('contraseña', { exact: true }).fill('dev-tools-fixture')
  await player.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(player).toHaveURL(/\/admin\//)
  await player.goto(`${uiBase}player`)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.length, { timeout: 30000 }).toBeGreaterThan(0)
  await emit('server/PLAYER_REQ_PLAY')
  const video = () => player.evaluate(() => ({ time: window.youtubeTransition.video?.currentTime, paused: window.youtubeTransition.video?.paused }))
  await expect.poll(async () => (await video()).time, { timeout: 20000 }).toBeGreaterThan(0)
  const panel = player.getByRole('complementary', { name: 'Herramientas de desarrollo' })
  if (development || httpsUi) {
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '+30 segundos', exact: true }).click()
    await expect.poll(async () => (await video()).time).toBeGreaterThan(30)
    await emit('server/PLAYER_REQ_PAUSE')
    await expect.poll(async () => (await video()).paused).toBe(true)
    for (const [width, height] of [[1440, 1000], [390, 844]]) {
      await player.setViewportSize({ width, height })
      await panel.getByRole('button', { name: 'Últimos 5 segundos', exact: true }).focus()
      await player.keyboard.press('Enter')
      await expect.poll(async () => (await video()).time).toBeCloseTo(55, 1)
      assert.equal((await video()).paused, true)
      await expect(panel).toContainText('Pulsa Reproducir')
      await expect.poll(async () => {
        const bounds = await panel.boundingBox()
        return bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height
      }).toBe(true)
      await player.screenshot({ path: path.join(data, `dev-player-${width}.png`) })
    }
    const firstQueueId = db.prepare('SELECT min(queueId) id FROM queue').get().id
    assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(firstQueueId).status, 'PLAYING')
    await emit('server/PLAYER_REQ_PLAY')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(firstQueueId).status, { timeout: 20000 }).toBe('PLAYED')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(firstQueueId + 1).status, { timeout: 20000 }).toBe('PLAYING')
    const phases = await player.evaluate(() => window.devToolPhases)
    for (const phase of ['Intro', 'Voz', 'Cargando', 'Canción']) {
      assert.ok(phases.includes(`Desarrollo · ${phase}`), `Missing phase ${phase}: ${phases}`)
    }
    await expect(panel).toContainText('Desarrollo · Canción')
    await panel.getByRole('button', { name: 'Últimos 5 segundos', exact: true }).click()
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(firstQueueId + 1).status, { timeout: 20000 }).toBe('PLAYED')
    await expect(panel).toContainText('Ambiente / espera', { timeout: 15000 })
  } else {
    await expect(panel).toHaveCount(0)
    await expect(player.getByRole('button', { name: 'Últimos 5 segundos', exact: true })).toHaveCount(0)
    // Production still completes through the provider's real media-ended event.
    await player.evaluate(() => {
      window.youtubeTransition.video.currentTime = 59
    })
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=1').get().status, { timeout: 15000 }).toBe('PLAYED')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, { timeout: 20000 }).toBe('PLAYING')
  }
  assert.deepEqual(errors, [])
  console.log(`PASS development seek, pause and natural transitions / production exclusion (${httpsUi ? 'HTTPS frontend, isolated API/socket' : development ? 'development StrictMode' : 'production'}). Artifacts: ${data}`)
} catch (error) {
  if (player && !player.isClosed()) await player.screenshot({ path: path.join(data, 'failure.png') })
  console.error({ artifacts: data, errors })
  throw error
} finally {
  socket?.close()
  await browser?.close()
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
