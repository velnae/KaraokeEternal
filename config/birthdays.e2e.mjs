import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'birthday-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const calls = []
let server, browser, socket, db, player
const errors = []
let lastStatus
for (const [name, seconds, hz] of [['intro', 1, 330], ['greeting', 12, 440], ['music', 15, 550]]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=24000`, '-t', String(seconds), path.join(data, `${name}.wav`)])
}
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=purple:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
const provider = createServer(async (req, res) => {
  if (req.url === '/v1/models') return res.end(JSON.stringify([{ model_id: 'eleven_v4' }]))
  if (req.url === '/v1/voices') return res.end(JSON.stringify({ voices: [{ voice_id: 'testvoice', name: 'Voz especial' }] }))
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  calls.push({ url: req.url, body })
  if (req.url.includes('generateContent')) {
    const input = JSON.parse(body.contents[0].parts[0].text)
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ script: `${input.name}, hoy la música nos reúne para celebrar contigo. Que esta noche esté llena de sonrisas y canciones memorables. Gracias por elegirnos para compartir este momento tan especial. ¡Feliz cumpleaños!` }) }] } }] }))
  }
  res.setHeader('Content-Type', 'audio/wav')
  res.end(fs.readFileSync(path.join(data, 'greeting.wav')))
})
const providerPort = await listen(provider)
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_YOUTUBE_API_KEY: '', KES_ROTATE_KEY: 'false',
      KES_GEMINI_API_KEY: 'fixture-only', KES_GEMINI_BASE_URL: `http://127.0.0.1:${providerPort}`, KES_ELEVENLABS_API_KEY: 'fixture-only', KES_ELEVENLABS_BASE_URL: `http://127.0.0.1:${providerPort}` },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${data}`)
    try {
      return (await api.get(`${base}api/prefs`)).status()
    } catch { return 0 }
  }, { timeout: 120000 }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const done = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await done
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(10000).emitWithAck('action', { type, payload: typeof payload === 'number' ? payload : { ...payload, expiresAt: Date.now() + 5000 } })
  assert.ok(!response.error, response.error)
  return response.payload
}
const event = async id => (await call('birthdays/')).events.find(item => item.id === id)
try {
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'birthday-test', newPasswordConfirm: 'birthday-test' })
  await stop()
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Fixture\',\'fixture\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Fixture song\',\'fixture song\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',5,1)')
  await start()
  await call('login', { username: 'admin', password: 'birthday-test', roomId: 1 })
  const resources = {}
  for (const kind of ['intro', 'music']) {
    const response = await api.post(`${base}api/birthdays/upload`, { multipart: { kind, file: { name: `${kind}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(data, `${kind}.wav`)) } } })
    assert.equal(response.status(), 200, await response.text())
    resources[kind] = await response.json()
  }
  const upload = await api.post(`${base}api/animation/background/upload`, { multipart: { requestId: 'birthday-background', file: { name: 'birthday.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'song.mp4')) } } })
  assert.equal(upload.status(), 202, await upload.text())
  const background = await upload.json()
  await expect.poll(async () => (await call(`animation/background/videos/${background.id}`)).state).toBe('ready')
  resources.video = await call('birthdays/video', { id: background.id })
  await call('birthdays/settings', { revision: 0, textModel: 'test-text-model', defaultVoiceId: 'testvoice', rules: [], introId: resources.intro.id, musicId: resources.music.id, videoId: resources.video.id }, 'PUT')
  const unauthenticated = await request.newContext()
  assert.equal((await unauthenticated.get(`${base}api/birthdays/`)).status(), 403)
  assert.equal((await unauthenticated.get(`${base}api/birthdays/assets/${resources.intro.id}`)).status(), 403)
  await unauthenticated.dispose()
  const cookie = (await api.storageState()).cookies.map(item => `${item.name}=${item.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
  socket.connect()
  socket.on('action', (action) => {
    if (action.type === 'status/PLAYER_STATUS') lastStatus = action.payload
  })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  if (httpsUi) {
    // Exercise the tunnel's real frontend while keeping fixtures and playback
    // authority on the isolated server, never on the shared venue database.
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      for (const name of ['content-type', 'range', 'if-range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
      try {
        const response = await api.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const open = await response.text()
          const handshake = JSON.parse(open.slice(1))
          handshake.upgrades = []
          const responseHeaders = response.headers()
          delete responseHeaders['content-length']
          await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch {
        await route.abort('failed').catch(() => {})
      }
    }
    await context.route(`${uiBase}api/**`, route => forward(route))
    await context.route(`${uiBase}socket.io/**`, route => forward(route, true))
  }
  const admin = await context.newPage()
  await admin.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/queue')}`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('birthday-test')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await admin.getByRole('button', { name: 'Preparar cumpleaños', exact: true }).click()
  const dialog = admin.getByRole('dialog')
  await dialog.getByLabel('Nombre', { exact: true }).fill('María')
  await dialog.getByRole('combobox', { name: 'Sexo', exact: true }).selectOption('female')
  await dialog.getByLabel('Año de nacimiento', { exact: true }).fill('2000')
  await dialog.getByRole('button', { name: 'Preparar saludo', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await call('birthdays/')).events[0]?.preparation, { timeout: 20000 }).toBe('ready')
  const birthday = (await call('birthdays/')).events[0]
  assert.equal(birthday.playback, 'held')
  assert.ok(birthday.durationMs > 25000)
  assert.equal(calls.filter(item => item.url.includes('generateContent')).length, 1)
  const prompt = JSON.parse(calls.find(item => item.url.includes('generateContent')).body.contents[0].parts[0].text)
  assert.equal(prompt.age, new Date().getFullYear() - 2000)
  assert.equal(prompt.birthYear, undefined)
  await admin.reload()
  await expect(admin.getByRole('article', { name: 'Cumpleaños de María', exact: true })).toBeVisible()
  await admin.getByRole('button', { name: 'Escuchar prueba', exact: true }).click()
  await expect(admin.getByText('Prueba en este dispositivo', { exact: true })).toBeVisible()
  assert.equal((await event(birthday.id)).playback, 'held')
  await admin.getByRole('button', { name: 'Cerrar prueba', exact: true }).click()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await admin.screenshot({ path: path.join(data, `queue-${width}.png`), fullPage: true })
  }
  await admin.goto(`${uiBase}admin/settings/birthdays`)
  await expect(admin.getByRole('textbox', { name: 'Modelo de texto Gemini', exact: true })).toHaveValue('test-text-model')
  await expect(admin.getByRole('button', { name: 'Escuchar introducción', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await admin.screenshot({ path: path.join(data, `settings-${width}.png`), fullPage: true })
  }
  await admin.goto(`${uiBase}queue`)
  await context.addInitScript(() => {
    window.birthdayTrace = []
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const node = create.call(this)
      const start = node.start.bind(node)
      const connect = node.connect.bind(node)
      node.connect = (...args) => {
        if (args[0] instanceof GainNode) node.birthdayGain = args[0]
        return connect(...args)
      }
      node.start = (...args) => {
        window.birthdayGain = node.birthdayGain
        window.birthdayTrace.push({ duration: node.buffer?.duration, at: performance.now() })
        return start(...args)
      }
      return node
    }
  })
  player = await context.newPage()
  player.on('pageerror', error => errors.push(error.message))
  await player.goto(`${uiBase}player`)
  for (let i = 0; i < 2; i++) await emit('server/QUEUE_ADD', { songId: 1, origin: 'OPERATOR', requestId: crypto.randomUUID() })
  await player.getByRole('button', { name: 'Reproducir', exact: true }).last().click()
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYING\'').get().n, { timeout: 15000 }).toBe(1)
  const current = db.prepare('SELECT queueId FROM queue WHERE status=\'PLAYING\'').get().queueId
  await emit('server/PLAYER_REQ_PAUSE')
  const replies = await Promise.all([0, 1].map(() => api.post(`${base}api/birthdays/events/${birthday.id}`, { data: { operation: 'schedule', revision: birthday.revision } })))
  assert.ok(replies.every(response => response.status() === 200))
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(current).status, 'PLAYING')
  assert.equal((await event(birthday.id)).playback, 'scheduled')
  const publicState = await emit('server/BIRTHDAY_SYNC')
  for (const field of ['sex', 'birthYear', 'celebrationYear', 'script', 'voiceId']) assert.equal(publicState.events[0][field], undefined)
  await expect(admin.locator('[data-birthday-id]')).toContainText('Cumpleaños de María')
  await admin.getByRole('button', { name: 'Retirar programación', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect.poll(async () => (await event(birthday.id)).playback).toBe('held')
  const held = await event(birthday.id)
  await call(`birthdays/events/${birthday.id}`, { operation: 'schedule', revision: held.revision })
  await emit('server/PLAYER_REQ_PLAY')
  const unlock = player.getByRole('button', { name: 'Permitir sonido', exact: true })
  await expect(unlock).toBeVisible()
  await unlock.click()
  await expect.poll(async () => (await event(birthday.id)).playback, { timeout: 20000 }).toBe('playing')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(current).status, 'PLAYED')
  await expect(player.getByRole('heading', { name: 'María', exact: true })).toBeVisible()
  assert.equal(await player.locator('section[aria-label="Cumpleaños de María"] video').evaluate(video => video.muted), true)
  await player.screenshot({ path: path.join(data, 'birthday-player.png') })
  await player.setViewportSize({ width: 390, height: 900 })
  await expect(player.getByRole('heading', { name: 'María', exact: true })).toBeInViewport({ ratio: 1 })
  await player.screenshot({ path: path.join(data, 'birthday-player-mobile.png') })
  await player.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(async () => (await event(birthday.id)).phase, { timeout: 20000 }).toBe('music')
  await emit('server/PLAYER_REQ_VOLUME', 0.35)
  await expect.poll(() => player.evaluate(() => Math.round(window.birthdayGain.gain.value * 100))).toBe(35)
  const eventVideo = player.locator('section[aria-label="Cumpleaños de María"] video')
  await expect(eventVideo).toBeVisible()
  await eventVideo.evaluate(video => video.dispatchEvent(new Event('error')))
  await expect(eventVideo).toHaveCount(0)
  await expect(player.getByRole('heading', { name: 'María', exact: true })).toBeVisible()
  await expect.poll(async () => (await event(birthday.id)).playback, { timeout: 45000 }).toBe('completed')
  const trace = await player.evaluate(() => window.birthdayTrace)
  assert.equal(trace.length, 3, JSON.stringify(trace))
  assert.ok(trace[0].duration >= 1 && trace[0].duration < 1.2)
  assert.ok(trace[1].duration >= 12 && trace[1].duration < 12.2)
  assert.ok(trace[2].duration >= 15 && trace[2].duration < 15.2)
  assert.ok(trace[1].at - trace[0].at >= 900)
  assert.ok(trace[2].at - trace[1].at >= 11900)
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYED\'').get().n, { timeout: 12000 }).toBe(2)
  const idle = await call('birthdays/events', { name: 'José', sex: 'male', birthYear: 1990, requestId: crypto.randomUUID() })
  await expect.poll(async () => (await event(idle.id)).preparation, { timeout: 20000 }).toBe('ready')
  await call(`birthdays/events/${idle.id}`, { operation: 'schedule', revision: idle.revision })
  await expect.poll(async () => (await event(idle.id)).playback).toBe('playing')
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(async () => (await event(idle.id)).playback).toBe('interrupted')
  await player.reload()
  assert.equal((await event(idle.id)).playback, 'interrupted')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ mode: development ? 'development' : 'production', httpsUi, assertions: 'private context; real generation pipeline with fixture providers; >25s event; held/reload/preview; keyboard/mobile; paused song and withdrawal; queued next without interruption; exclusive intro/greeting/full music; video failure keeps name and audio; resumes next song; idle start; interrupted no replay', artifacts: data }, null, 2))
} catch (error) {
  console.error('Last player status', lastStatus, 'page errors', errors)
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(data, `failure-${context.pages().indexOf(page)}.png`), fullPage: true }).catch(() => {})
    console.error(await page.locator('body').innerText().catch(() => 'Page closed'))
  }
  throw error
} finally {
  socket?.disconnect()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
  console.log(`Birthday E2E artifacts: ${data}`)
}
