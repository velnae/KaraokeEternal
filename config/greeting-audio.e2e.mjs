import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { runGreetingPlaybackChecks } from './greeting-playback-checks.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const playbackMode = process.env.KARAOKE_E2E_GREETING_PLAYBACK === '1'
const localDuration = playbackMode ? 2 : 5
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'g-audio-e2e-'))
const installation = path.join(data, 'tts')
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
const api = await request.newContext()
const anonymous = await request.newContext()
const foreign = await request.newContext()
const errors = []
const sockets = []
const workerSockets = new Set()
let server, browser, db, admin, guest, player, adminContext, guestContext
let workerRunning = false
let held = false
let corrupt = false
let releaseGeneration
const requests = []
const workerQueue = []
const pass = name => console.log(`PASS ${name}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const videoIds = ['fixture0001', 'fixture0002', 'fixture0003', 'fixture0004', 'fixture0005', 'fixture0006']
const provider = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ items: (url.searchParams.get('id') || videoIds[0]).split(',').map(id => ({
    id, snippet: { title: `Canción ${id}`, channelTitle: 'Fixture', categoryId: '10', liveBroadcastContent: 'none', thumbnails: {} },
    contentDetails: { duration: 'PT5S' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
  })) }))
})
const providerPort = await listen(provider)

fs.mkdirSync(path.join(installation, '.tmp'), { recursive: true })
fs.mkdirSync(path.join(installation, '.venv/bin'), { recursive: true })
fs.mkdirSync(path.join(installation, 'reference'))
fs.symlinkSync(process.execPath, path.join(installation, '.venv/bin/python'))
for (const name of ['model.sh', 'resident.py', 'speak.py']) fs.writeFileSync(path.join(installation, name), '# External socket fixture\n')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=24000', '-t', '0.5', path.join(installation, 'reference/es_mx_f1.wav')])
let wave = fs.readFileSync(path.join(installation, 'reference/es_mx_f1.wav'))
let speechDuration = 0.5
const setSpeech = (seconds, source) => {
  const file = path.join(data, 'speech-fixture.wav')
  const input = source ? ['-i', source] : ['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=24000', '-t', String(seconds)]
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...input, file])
  wave = fs.readFileSync(file)
  speechDuration = seconds
}
const drainWorker = async () => {
  if (workerRunning) return
  workerRunning = true
  try {
    while (workerQueue.length) {
      const { socket, payload } = workerQueue.shift()
      let result = { status: 'ready', pid: process.pid }
      if (payload.action === 'say') {
        if (held) await new Promise((resolve) => {
          releaseGeneration = resolve
        })
        const output = payload.args[payload.args.indexOf('--output') + 1]
        fs.writeFileSync(output, corrupt ? 'invalid audio' : wave)
        fs.writeFileSync(output.replace(/\.wav$/, '.json'), '{}')
        result = { output, audio_seconds: speechDuration, sample_rate: 24000 }
      }
      if (!socket.destroyed) socket.end(JSON.stringify({ ok: true, result }) + '\n')
    }
  } finally { workerRunning = false }
}
const worker = createSocketServer((socket) => {
  workerSockets.add(socket)
  socket.on('error', () => {})
  socket.once('close', () => workerSockets.delete(socket))
  socket.once('data', (bytes) => {
    const payload = JSON.parse(bytes.toString())
    if (payload.action === 'say') requests.push(payload.args)
    workerQueue.push({ socket, payload })
    void drainWorker()
  })
})
await new Promise(resolve => worker.listen(path.join(installation, '.tmp/model.sock'), resolve))
const release = () => {
  held = false
  releaseGeneration?.()
}
const call = async (context, suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await context.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', data,
    '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false',
      KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: 'fixture-only', KARAOKE_E2E_YOUTUBE_ORIGIN: `http://127.0.0.1:${providerPort}`,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/youtube-fetch.mjs')).href}` },
  })
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for the isolated server. */ }
    await sleep(100)
  }
  throw new Error('Server did not start')
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exit = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exit
}
const connect = async (context) => {
  const cookie = (await context.storageState()).cookies.map(row => `${row.name}=${row.value}`).join('; ')
  const socket = io(origin, { path: '/karaoke/socket.io', extraHeaders: { cookie }, transports: ['websocket'], autoConnect: false })
  sockets.push(socket)
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}
const emit = async (socket, type, payload) => {
  const reply = await socket.timeout(3000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 2000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}
const records = () => db.prepare('SELECT * FROM greetings ORDER BY greetingId').all()
const job = greetingId => db.prepare('SELECT j.* FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.greetingId=?').get(greetingId)
const ready = greetingId => expect.poll(() => job(greetingId)?.status, { timeout: 10000 }).toBe('ready')
const submit = async (index, message, intent = 'LISTEN') => {
  await guest.goto(`${base}requests`)
  await guest.goto(`${base}library`)
  await guest.getByRole('radio', { name: intent === 'SING' ? 'Cantar karaoke' : 'Escuchar música', exact: true }).check()
  await guest.getByRole('searchbox', { name: 'Buscar canción o artista' }).fill(`https://youtu.be/${videoIds[index]}`)
  await expect(guest.getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled()
  await guest.getByRole('searchbox', { name: 'Buscar canción o artista' }).press('Enter')
  const card = guest.locator(`[data-source-id="${videoIds[index]}"]`)
  await expect(card.getByRole('checkbox', { name: /Agregar saludo/ })).toHaveCount(0)
  await card.getByRole('button', { name: 'Pedir canción', exact: true }).click()
  await expect(guest).toHaveURL(`${base}requests`)
  const queueId = db.prepare('SELECT queueId FROM queue WHERE externalId=? ORDER BY queueId DESC LIMIT 1').get(videoIds[index]).queueId
  const requested = guest.locator(`[data-queue-id="${queueId}"]`)
  await expect(requested.getByRole('heading')).toBeFocused()
  await requested.getByRole('button', { name: 'Agregar saludo', exact: true }).click()
  await expect(requested.getByLabel('Para (opcional)')).toHaveCount(0)
  await requested.getByLabel('Mensaje', { exact: true }).fill(message)
  await requested.getByRole('button', { name: 'Guardar saludo', exact: true }).click()
  await expect(requested.getByRole('group', { name: 'Saludo', exact: true })).toContainText(message)
  return records().at(-1)
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', String(localDuration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call(api, 'setup', { username: 'admin', newPassword: 'greeting-audio-test', newPasswordConfirm: 'greeting-audio-test', name: 'Operator' })
  const room = (await call(api, 'rooms/1')).entities[1]
  await call(api, 'rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OPTIONAL' }, queue: { maxPendingPerParticipant: 10, maxSongsPerParticipantRound: playbackMode ? 2 : 1, houseTracksBeforeParticipant: 0, approvalMode: 'AUTO' } } }, 'PUT')
  await call(api, 'rooms', { name: 'Other room', status: 'open' })
  const tables = await call(api, 'rooms/1/tables', { code: '4', name: 'Terraza', status: 'active' })
  const { invitation } = await call(api, `rooms/1/tables/${tables[0].tableId}/qr`)
  await call(api, 'login', { username: 'admin', password: 'greeting-audio-test', roomId: 1 })
  await call(foreign, 'login', { username: 'admin', password: 'greeting-audio-test', roomId: 2 })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec(`INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,'Local song','local song');`)
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec(`INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,'song.mp4',${localDuration},1)`)
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  guestContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true })
  let preparationDelay = 'reply'
  let delayedPreparations = 0
  await adminContext.routeWebSocket(/\/socket\.io\//, (socket) => {
    const upstream = socket.connectToServer()
    const delayedReplies = new Set()
    socket.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^42(\d+)(\[.*)$/)
      const action = packet && JSON.parse(packet[2])[1]
      if (action?.type === 'server/GREETINGS' && action.payload?.operation === 'prepareAudio' && preparationDelay) {
        delayedPreparations++
        if (preparationDelay === 'request') {
          setTimeout(() => upstream.send(message), 2200)
          return
        }
        delayedReplies.add(packet[1])
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^43(\d+)\[/)
      if (packet && delayedReplies.delete(packet[1])) setTimeout(() => socket.send(message), 2200)
      else socket.send(message)
    })
  })
  for (const context of [adminContext, guestContext]) context.on('page', (page) => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Encountered two children with the same key')) errors.push(message.text())
    })
  })
  admin = await adminContext.newPage()
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('greeting-audio-test')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${base}admin/settings/animator?view=local-voice`)
  await admin.getByLabel('Ruta de instalación en el servidor', { exact: true }).fill(installation)
  await admin.getByRole('button', { name: 'Guardar y comprobar', exact: true }).click()
  await expect(admin.getByText('Modelo listo', { exact: true })).toBeVisible()
  await expect(admin.getByText('Configuración guardada.', { exact: true })).toBeVisible()
  await admin.getByRole('checkbox', { name: 'Preparar voz mientras los pedidos esperan' }).focus()
  await admin.keyboard.press('Space')
  await expect.poll(() => db.prepare('SELECT audioEnabled FROM greetingControls WHERE roomId=1').get()?.audioEnabled).toBe(1)
  await admin.waitForTimeout(1700)
  const preparation = admin.getByRole('checkbox', { name: 'Preparar voz mientras los pedidos esperan' })
  assert.equal(delayedPreparations, 1)
  await expect(preparation).toBeDisabled({ timeout: 100 })
  await expect(admin.getByText('Esperando la confirmación del servidor…', { exact: true })).toBeVisible()
  await expect(preparation).toBeEnabled()
  await expect(preparation).toBeChecked()
  assert.equal(await admin.getByRole('alert').count(), 0)
  preparationDelay = 'request'
  await preparation.focus()
  await admin.keyboard.press('Space')
  await expect.poll(() => db.prepare('SELECT audioEnabled FROM greetingControls WHERE roomId=1').get()?.audioEnabled).toBe(0)
  await expect(preparation).not.toBeChecked()
  await expect(preparation).toBeEnabled()
  assert.equal(await admin.getByRole('alert').count(), 0)
  assert.equal(delayedPreparations, 2)
  preparationDelay = ''
  await preparation.focus()
  await admin.keyboard.press('Space')
  await expect(preparation).toBeChecked()
  pass('Preparation settings tolerate delayed requests and acknowledgements without false timeouts or expired commands')
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.getByRole('checkbox', { name: 'Preparar voz mientras los pedidos esperan' }).scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `preparation-settings-${width}.png`) })
  }
  guest = await guestContext.newPage()
  await guest.goto(`${base}join#${invitation}`)
  await guest.getByLabel('Tu nombre').fill('Ana')
  await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(guest.getByRole('heading', { name: '¿Qué quieres pedir?' })).toBeVisible()
  held = true
  const first = await submit(0, '¡Feliz cumpleaños!', playbackMode ? 'SING' : 'LISTEN')
  const second = await submit(1, '¡Feliz cumpleaños!')
  await expect.poll(() => requests.length).toBe(1)
  await expect.poll(() => job(first.greetingId)?.status).toBe('generating')
  await expect.poll(() => job(second.greetingId)?.jobId).toBe(job(first.greetingId).jobId)
  assert.ok(records().every(row => row.status === 'QUEUED'))
  await admin.goto(`${base}queue`)
  await expect(admin.locator(`[data-queue-id="${first.queueId}"]`).getByText('Generando voz', { exact: true })).toBeVisible()
  release()
  await ready(first.greetingId)
  await ready(second.greetingId)
  await expect(admin.locator(`[data-queue-id="${first.queueId}"]`).getByText('Audio preparado', { exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.locator(`[data-queue-id="${first.queueId}"]`).scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `prepared-${width}.png`) })
  }
  await guest.goto(`${base}requests`)
  const participantCard = guest.locator(`[data-queue-id="${first.queueId}"]`)
  await expect(participantCard.getByRole('group', { name: 'Saludo', exact: true })).toContainText(first.message)
  await expect(participantCard.getByText('Audio preparado', { exact: true })).toHaveCount(0)
  await expect(participantCard.getByText('Detalle de la voz', { exact: true })).toHaveCount(0)
  const removeAction = await participantCard.getByRole('button', { name: 'Quitar saludo', exact: true }).boundingBox()
  const cancelAction = await participantCard.getByRole('button', { name: 'Cancelar pedido', exact: true }).boundingBox()
  assert.ok(Math.abs(removeAction.y - cancelAction.y) < 1)
  await guest.screenshot({ path: path.join(data, 'participant-prepared-390.png') })
  const audioPath = `${base}api/greetings/${first.greetingId}/audio`
  const audio = await api.get(audioPath)
  assert.equal(audio.status(), 200)
  assert.match(audio.headers()['cache-control'], /no-store/)
  if (!development) assert.match(audio.headers()['cache-control'], /private/)
  assert.equal((await anonymous.get(audioPath)).status(), 403)
  assert.equal((await guestContext.request.get(audioPath)).status(), 403)
  assert.equal((await foreign.get(audioPath)).status(), 404)
  const decoded = await admin.evaluate(async (url) => {
    const context = new AudioContext()
    try {
      return (await context.decodeAudioData(await (await fetch(url)).arrayBuffer())).duration
    } finally { await context.close() }
  }, audioPath)
  assert.ok(decoded > 0 && decoded <= 20)
  pass('Real QR orders prepare one validated private audio for two separate greetings; keyboard and responsive UI')

  if (playbackMode) {
    await runGreetingPlaybackChecks({ api, admin, adminContext, guestContext, db, base, data, first, second, call, connect, emit, job, ready, start, stop, setSpeech, installation, setPlayer: (page) => {
      player = page
    } })
  } else {
    held = true
    const cancelled = await submit(2, 'Este saludo se cancela')
    await expect.poll(() => job(cancelled.greetingId)?.status).toBe('generating')
    await guest.goto(`${base}requests`)
    await guest.locator(`[data-queue-id="${cancelled.queueId}"]`).getByRole('button', { name: 'Quitar saludo', exact: true }).click()
    await expect.poll(() => job(cancelled.greetingId)?.cancelRequested).toBe(1)
    release()
    await expect.poll(() => job(cancelled.greetingId)?.status).toBe('cancelled')
    assert.equal((await api.get(`${base}api/greetings/${cancelled.greetingId}/audio`)).status(), 404)
    pass('Cancellation discards a late generation without cancelling the musical request')

    held = true
    const interrupted = await submit(3, 'Recuperar esta preparación')
    await expect.poll(() => job(interrupted.greetingId)?.status).toBe('generating')
    const beforeRestart = requests.length
    await stop()
    assert.equal(job(interrupted.greetingId).status, 'uncertain')
    await start()
    await sleep(1000)
    assert.equal(requests.length, beforeRestart)
    release()
    await ready(interrupted.greetingId)
    assert.equal(job(interrupted.greetingId).attempts, 2)
    assert.equal(job(first.greetingId).jobId, job(second.greetingId).jobId)
    assert.equal((await api.get(audioPath)).status(), 200)
    assert.doesNotMatch(fs.readFileSync(path.join(data, 'server.log'), 'utf8'), /database is (?:not open|closed)/i)
    pass('SQLite preserves interrupted work and ready cache; restart waits for the old external worker before its single retry')

    corrupt = true
    const fallback = await submit(4, 'Este saludo sigue en pantalla')
    await expect.poll(() => job(fallback.greetingId)?.status).toBe('failed')
    const operator = await connect(api)
    await emit(operator, 'server/QUEUE_REMOVE', { queueId: records().filter(row => row.greetingId !== fallback.greetingId).map(row => row.queueId) })
    db.prepare(`UPDATE queue SET source='LOCAL',songId=1,externalId=NULL WHERE queueId=?`).run(fallback.queueId)
    await admin.goto(`${base}queue`)
    await expect(admin.locator(`[data-queue-id="${fallback.queueId}"]`).getByText('Solo pantalla', { exact: true })).toBeVisible()
    player = await adminContext.newPage()
    await player.goto(`${base}player`)
    await player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
    await expect(player.getByTestId('greeting-overlay')).toContainText(fallback.message)
    await player.screenshot({ path: path.join(data, 'visual-fallback.png') })
    await expect.poll(() => records().find(row => row.greetingId === fallback.greetingId).status, { timeout: 20000 }).toBe('DISPLAYED')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(fallback.queueId).status, { timeout: 12000 }).toBe('PLAYED')
    await player.close()
    pass('Failed voice preparation still delivers the visual greeting and continues real local music')

    if (process.env.KES_TTS_TEST_INSTALLATION) {
      const local = (await call(api, 'prefs/local-tts')).config
      await call(api, 'prefs/local-tts', { ...local, installationPath: process.env.KES_TTS_TEST_INSTALLATION, autoStart: true }, 'PUT')
      await expect.poll(async () => (await call(api, 'prefs/local-tts')).state, { timeout: 125000 }).toBe('ready')
      const real = await submit(5, 'Que disfrutes la noche.')
      await expect.poll(() => job(real.greetingId)?.status, { timeout: 150000 }).toBe('ready')
      const result = await api.get(`${base}api/greetings/${real.greetingId}/audio`)
      assert.equal(result.status(), 200)
      fs.writeFileSync(path.join(data, 'real-greeting.mp3'), await result.body())
      assert.equal(records().find(row => row.greetingId === real.greetingId).status, 'QUEUED')
      console.log(`PASS Real Chatterbox greeting generated and validated: ${job(real.greetingId).durationMs} ms; no voice playback`)
    }
  }
  assert.deepEqual(errors, [])
  console.log(`Greeting ${playbackMode ? 'playback' : 'audio'} ${development ? 'development StrictMode' : 'production'} E2E passed. Artifacts: ${data}`)
} catch (error) {
  for (const [name, page] of [['admin', admin], ['guest', guest], ['player', player]]) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(data, `failure-${name}.png`) }).catch(() => {})
      fs.writeFileSync(path.join(data, `failure-${name}.json`), JSON.stringify({ url: page.url(), errors, accessibility: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2))
      if (name === 'player') fs.writeFileSync(path.join(data, 'failure-audio-trace.json'), JSON.stringify(await page.evaluate(() => window.audioTrace ?? null), null, 2))
    }
  }
  throw error
} finally {
  release()
  sockets.forEach(socket => socket.disconnect())
  await browser?.close()
  await stop()
  db?.close()
  for (const socket of workerSockets) socket.destroy()
  await new Promise(resolve => worker.close(resolve))
  await new Promise(resolve => provider.close(resolve))
  await Promise.all([api.dispose(), anonymous.dispose(), foreign.dispose()])
  fs.closeSync(log)
  console.log(`Artifacts: ${data}`)
}
