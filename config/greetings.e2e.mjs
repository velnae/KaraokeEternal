import { chromium, request, expect } from 'playwright/test'
import { installYouTubePreviewMock, confirmSongPreview } from './fixtures/youtube-preview.mjs'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-greetings-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
const ids = ['fixture0001', 'fixture0002', 'fixture0003']
const provider = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('Content-Type', 'application/json')
  const items = url.pathname.endsWith('/search')
    ? ids.map(videoId => ({ id: { videoId } }))
    : url.searchParams.get('id').split(',').map(id => ({
        id, snippet: { title: `Canción ${ids.indexOf(id) + 1}`, channelTitle: 'Fixture', categoryId: '10', liveBroadcastContent: 'none', thumbnails: {} },
        contentDetails: { duration: 'PT5S' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
      }))
  res.end(JSON.stringify({ items }))
})
const providerPort = await listen(provider)
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const participantBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const errors = []
const sockets = []
let server, browser, db, admin, guest, player, guestApi
const pass = name => console.log(`PASS ${name}`)
const call = async (context, url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await context.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  const entry = development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']
  server = spawn(process.execPath, [...entry, '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false',
      KES_GEMINI_API_KEY: '', KES_YOUTUBE_API_KEY: 'test-only', KARAOKE_E2E_YOUTUBE_ORIGIN: `http://127.0.0.1:${providerPort}`,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/youtube-fetch.mjs')).href}` },
  })
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for isolated process. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Server did not start')
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const ended = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await ended
}
const connect = async (context) => {
  const cookie = (await context.storageState()).cookies.map(row => `${row.name}=${row.value}`).join('; ')
  const sock = io(origin, { path: '/karaoke/socket.io', extraHeaders: { cookie }, transports: ['websocket'], autoConnect: false })
  sockets.push(sock)
  sock.connect()
  await new Promise((resolve, reject) => {
    sock.once('connect', resolve)
    sock.once('connect_error', reject)
  })
  return sock
}
const emit = async (sock, type, payload = {}) => {
  const reply = await sock.timeout(3000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 2000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}
const records = () => db.prepare('SELECT * FROM greetings ORDER BY greetingId').all()
const backgroundPlayer = async (hidden) => {
  // Headless tabs do not reliably throttle like desktop background tabs. Model
  // the browser signals, suspended animation frames and coalesced timers explicitly.
  await player.evaluate((hidden) => {
    if (hidden) {
      if (window.greetingBackgroundFixture) return
      const frame = window.requestAnimationFrame
      const timeout = window.setTimeout
      window.greetingBackgroundFixture = { frame, timeout }
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      let frameId = 1000000000
      window.requestAnimationFrame = () => ++frameId
      window.setTimeout = (handler, ms = 0, ...args) => timeout(handler, Math.max(1000, ms), ...args)
    } else if (window.greetingBackgroundFixture) {
      window.requestAnimationFrame = window.greetingBackgroundFixture.frame
      window.setTimeout = window.greetingBackgroundFixture.timeout
      delete window.greetingBackgroundFixture
      delete document.visibilityState
      delete document.hidden
    }
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
  if (hidden) await admin.bringToFront()
  else await player.bringToFront()
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call(api, 'setup', { username: 'admin', newPassword: 'greetings-password', newPasswordConfirm: 'greetings-password', name: 'Operator' })
  const room = (await call(api, 'rooms/1')).entities[1]
  await call(api, 'rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OPTIONAL' }, queue: { maxPendingPerParticipant: 2, maxSongsPerParticipantRound: 2, houseTracksBeforeParticipant: 0, approvalMode: 'AUTO' } } }, 'PUT')
  const tables = await call(api, 'rooms/1/tables', { code: '4', name: 'Terraza', status: 'active' })
  const { invitation } = await call(api, `rooms/1/tables/${tables[0].tableId}/qr`)
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Fixture\',\'fixture\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Local A\',\'local a\'),(2,1,\'Local B\',\'local b\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',5,1),(2,2,1,\'song.mp4\',5,1)')
  await stop()
  // Reproduce an existing installation that applied the early revision of 016.
  for (const migration of db.prepare('SELECT id,down FROM migrations WHERE id>16 ORDER BY id DESC').all()) {
    if (migration.down) db.exec(migration.down)
    db.prepare('DELETE FROM migrations WHERE id=?').run(migration.id)
  }
  db.exec('ALTER TABLE greetingTurnItems DROP COLUMN position')
  const earlyGreetingSchema = db.prepare('SELECT up FROM migrations WHERE id=16').get().up.replace('  position INTEGER NOT NULL,\n', '')
  db.prepare('UPDATE migrations SET up=? WHERE id=16').run(earlyGreetingSchema)
  await start()
  assert.ok(db.prepare('PRAGMA table_info(greetingTurnItems)').all().some(column => column.name === 'position'))
  assert.equal(db.prepare('SELECT count(*) n FROM migrations WHERE id=17').get().n, 1)
  pass('Startup repairs the early greeting schema before real player delivery')
  await call(api, 'login', { username: 'admin', password: 'greetings-password', roomId: 1 })
  const operator = await connect(api)
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  adminContext.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  admin = await adminContext.newPage()
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('greetings-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${base}queue`)
  await expect(admin.getByRole('heading', { name: 'La cola de reproducción está vacía' })).toBeVisible()
  await expect(admin.getByRole('region', { name: 'Cola de saludos' })).toHaveCount(0)
  const songCard = queueId => admin.locator(`[data-queue-id="${queueId}"]`)
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true })
  await installYouTubePreviewMock(guestContext)
  if (httpsUi) {
    // Fetch real tunnel-served UI assets while keeping all test requests and
    // participant identities in the isolated database, never the shared room.
    guestApi = await request.newContext()
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      for (const name of ['content-type', 'range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
      try {
        const response = await guestApi.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch (error) {
        if (guest && !guest.isClosed()) errors.push(`${url.pathname}: ${error.message.split('\n')[0]}`)
        await route.abort().catch(() => {})
      }
    }
    await guestContext.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await guestContext.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await guestContext.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  let loseNextOrder = true
  let rejectNextGreeting = true
  let loseNextGreeting = false
  let awaitingGreetingRetry = false
  if (!httpsUi) await guestContext.routeWebSocket(/\/socket\.io\//, (socket) => {
    const upstream = socket.connectToServer()
    const lost = new Set()
    socket.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^42(\d+)(\[.*)$/)
      const action = packet && JSON.parse(packet[2])[1]
      if (action?.type === 'server/QUEUE_ADD' && loseNextOrder) {
        loseNextOrder = false
        lost.add(packet[1])
      }
      if (action?.type === 'server/GREETINGS' && action.payload?.operation === 'attach') {
        if (rejectNextGreeting) {
          rejectNextGreeting = false
          socket.send(`43${packet[1]}${JSON.stringify([{ error: 'No se pudo guardar el saludo. Intente nuevamente.' }])}`)
          return
        }
        if (loseNextGreeting) {
          loseNextGreeting = false
          awaitingGreetingRetry = true
          lost.add(packet[1])
        } else awaitingGreetingRetry = false
      }
      if (action?.type === 'server/GREETINGS' && action.payload?.operation === 'read' && awaitingGreetingRetry) lost.add(packet[1])
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^43(\d+)\[/)
      if (packet && lost.delete(packet[1])) return
      socket.send(message)
    })
  })
  guestContext.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  guest = await guestContext.newPage()
  await guest.goto(`${participantBase}join#${invitation}`)
  await guest.getByLabel('Tu nombre').fill('Ana')
  await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(guest.getByRole('heading', { name: '¿Qué quieres pedir?' })).toBeVisible()
  for (const [index, message] of ['¡Feliz cumpleaños!', '¡Que disfruten la noche!'].entries()) {
    if (index) await guest.goto(`${participantBase}library`)
    await guest.getByRole('searchbox', { name: 'Buscar canción o artista' }).fill(`https://youtu.be/${ids[index]}`)
    await expect(guest.getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled()
    await guest.getByRole('searchbox', { name: 'Buscar canción o artista' }).press('Enter')
    await expect(guest.locator('article[data-source-id]')).toHaveCount(1)
    const card = guest.locator(`[data-source-id="${ids[index]}"]`)
    await expect(card.getByRole('checkbox', { name: /Agregar saludo/ })).toHaveCount(0)
    await expect(card.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: 'Pedir', exact: true }).focus()
    await guest.keyboard.press('Enter')
    await confirmSongPreview(guest)
    if (index === 0 && !httpsUi) {
      await expect(guest.getByRole('dialog').getByText('Pedido sin confirmar. Pulsa Confirmar para comprobarlo.')).toBeVisible({ timeout: 16000 })
      await expect(guest).toHaveURL(`${participantBase}library`)
      assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 1)
      await confirmSongPreview(guest)
    }
    await expect(guest).toHaveURL(`${participantBase}requests`)
    const queueId = db.prepare('SELECT queueId FROM queue WHERE externalId=?').get(ids[index]).queueId
    const requested = guest.locator(`[data-queue-id="${queueId}"]`)
    await expect(requested.getByRole('heading')).toBeFocused()
    await expect(requested).toHaveAttribute('data-recent', 'true')
    await requested.getByRole('button', { name: 'Agregar saludo', exact: true }).focus()
    await guest.keyboard.press('Enter')
    const input = requested.getByLabel('Mensaje', { exact: true })
    await expect(input).toBeFocused()
    await expect(requested.locator('textarea')).toHaveCount(1)
    await expect(requested.getByLabel('Para (opcional)')).toHaveCount(0)
    await input.fill('x'.repeat(300))
    assert.equal((await input.inputValue()).length, 211)
    await input.fill('¡Hola, ñustas! 🦙')
    await requested.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(requested.getByRole('button', { name: 'Agregar saludo', exact: true })).toBeFocused()
    assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, index + 1)
    await requested.getByRole('button', { name: 'Agregar saludo', exact: true }).click()
    await expect(input).toHaveValue('¡Hola, ñustas! 🦙')
    await input.fill(message)
    if (index === 0) {
      for (const width of [390, 1440]) {
        await guest.setViewportSize({ width, height: 1000 })
        assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `composer overflow ${width}`)
        await guest.screenshot({ path: path.join(data, `composer-${width}.png`) })
      }
    }
    if (index === 1 && !httpsUi) loseNextGreeting = true
    await requested.getByRole('button', { name: 'Guardar saludo', exact: true }).focus()
    await guest.keyboard.press('Enter')
    if (index === 0 && !httpsUi) {
      await expect(requested.getByRole('alert')).toContainText('No se pudo guardar')
      await expect(input).toHaveValue(message)
      assert.equal(records().length, 0)
      await requested.getByRole('button', { name: 'Guardar saludo', exact: true }).click()
    } else if (index === 1 && !httpsUi) {
      await expect(requested.getByRole('button', { name: 'Comprobar saludo', exact: true })).toBeVisible({ timeout: 8000 })
      await expect(input).toBeDisabled()
      assert.equal(records().length, 2)
      await requested.getByRole('button', { name: 'Comprobar saludo', exact: true }).click()
    }
    await expect(requested.getByRole('group', { name: 'Saludo', exact: true })).toContainText(message)
    await expect(requested.getByRole('button', { name: 'Agregar saludo', exact: true })).toHaveCount(0)
  }
  assert.equal(records().length, 2)
  assert.ok(records().every(row => row.sender === 'Ana' && row.recipient === '' && row.tableLabel.includes('4')))
  const guestSocket = await connect(guestApi ?? guestContext.request)
  const existing = db.prepare('SELECT requestId,externalId FROM queue ORDER BY queueId LIMIT 1').get()
  const duplicate = await emit(guestSocket, 'server/GREETINGS', { operation: 'attach', queueId: records()[0].queueId, message: records()[0].message })
  assert.equal(duplicate.payload.items.length, 2)
  await emit(guestSocket, 'server/QUEUE_ADD', { requestId: existing.requestId, source: 'YOUTUBE', sourceId: existing.externalId })
  assert.equal(records().length, 2)
  pass(httpsUi
    ? 'HTTPS participant flow confirms the exact card, single-field editor, attribution, draft retention and idempotency against isolated data'
    : 'Confirmed orders navigate to their own card; single-field greetings preserve drafts, attribution, Unicode limits and idempotent lost-reply recovery')
  await guest.goto(`${participantBase}requests`)
  await expect(guest.getByRole('region', { name: 'Mis saludos' })).toHaveCount(0)
  await expect(guest.getByRole('button', { name: 'Agregar saludo', exact: true })).toHaveCount(0)
  for (const row of records()) {
    await expect(guest.locator(`[data-queue-id="${row.queueId}"]`).getByRole('group', { name: 'Saludo', exact: true })).toContainText(row.message)
    await expect(songCard(row.queueId).getByRole('group', { name: 'Saludo', exact: true })).toContainText(row.message)
  }
  await expect(admin.getByRole('region', { name: 'Cola de saludos' })).toHaveCount(0)
  await expect(admin.getByText('Esperando tu turno', { exact: true })).toHaveCount(0)
  for (const width of [390, 1440]) {
    await guest.setViewportSize({ width, height: 1000 })
    await guest.locator(`[data-queue-id="${records()[0].queueId}"]`).scrollIntoViewIfNeeded()
    assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `requests overflow ${width}`)
    await guest.screenshot({ path: path.join(data, `requests-${width}.png`) })
    await admin.setViewportSize({ width, height: 1000 })
    const pauseControl = admin.getByRole('button', { name: 'Pausar saludos', exact: true })
    await pauseControl.scrollIntoViewIfNeeded()
    await expect(pauseControl).toBeInViewport({ ratio: 1 })
    await songCard(records()[0].queueId).scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `queue overflow ${width}`)
    await admin.screenshot({ path: path.join(data, `moderation-${width}.png`) })
  }
  // Use real local playback after exercising the provider/request path. No live YouTube dependency.
  db.exec('UPDATE queue SET source=\'LOCAL\',songId=queueId,externalId=NULL')
  player = await adminContext.newPage()
  await player.goto(`${base}player`)
  const transport = player.getByRole('toolbar', { name: 'Controles de reproducción' })
  const overlay = player.getByTestId('greeting-overlay')
  await expect(transport.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()
  await backgroundPlayer(true)
  await admin.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(overlay).toContainText('¡Feliz cumpleaños!')
  await expect.poll(() => records()[0].status).toBe('DISPLAYING')
  assert.equal(await player.evaluate(() => document.hidden), true)
  const firstStartedAt = records()[0].startedAt
  assert.equal(db.prepare('SELECT COUNT(*) n FROM queue WHERE status=\'PLAYING\'').get().n, 0)
  await backgroundPlayer(false)
  await expect(overlay).toContainText('¡Feliz cumpleaños!')
  assert.equal(records()[0].startedAt, firstStartedAt, 'returning to the player does not restart the greeting')
  await player.screenshot({ path: path.join(data, 'screen.png') })
  await backgroundPlayer(true)
  await expect.poll(() => records()[0].status, { timeout: 18000 }).toBe('DISPLAYED')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=1').get().status).toBe('PLAYING')
  assert.equal(records()[1].status, 'QUEUED')
  await expect(overlay).toHaveCount(0)
  await expect(overlay).toContainText('¡Que disfruten la noche!', { timeout: 10000 })
  await expect.poll(() => records()[1].status).toBe('DISPLAYING')
  assert.equal(await player.evaluate(() => document.hidden), true)
  await expect.poll(() => records().map(row => row.status), { timeout: 18000 }).toEqual(['DISPLAYED', 'DISPLAYED'])
  await backgroundPlayer(false)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=1').get().status, 'PLAYED')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, { timeout: 10000 }).toBe('PLAYING')
  await expect(overlay).toHaveCount(0)
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, { timeout: 10000 }).toBe('PLAYED')
  pass('Queue controls start background-player greetings with frames suspended; each greeting precedes its own song and tab changes preserve delivery')
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  const add = (songId, message) => emit(guestSocket, 'server/QUEUE_ADD', { source: 'LOCAL', songId, requestId: crypto.randomUUID(), greeting: { recipient: '', message } })
  await add(1, 'Quitar antes')
  await add(2, 'Retirar durante')
  const beforeCard = songCard(records().at(-2).queueId)
  const duringCard = songCard(records().at(-1).queueId)
  await expect(beforeCard.getByText('Quitar antes', { exact: true })).toBeVisible()
  const removeGreeting = beforeCard.getByRole('button', { name: 'Quitar saludo', exact: true })
  await expect(removeGreeting).toHaveAccessibleDescription('Local A')
  await removeGreeting.focus()
  await removeGreeting.press('Enter')
  await expect(beforeCard.getByText('Saludo retirado', { exact: true })).toBeVisible()
  await expect(beforeCard.getByText('Quitar antes', { exact: true })).toHaveCount(0)
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect(overlay).toContainText('Retirar durante', { timeout: 10000 })
  await duringCard.getByRole('button', { name: 'Retirar saludo', exact: true }).click()
  await expect(overlay).toHaveCount(0)
  assert.deepEqual(records().slice(-2).map(row => row.status), ['REMOVED', 'REMOVED'])
  await expect.poll(() => db.prepare('SELECT status FROM queue ORDER BY queueId DESC LIMIT 1').get().status, { timeout: 15000 }).toBe('PLAYED')
  pass('Operator removes a pending greeting and withdraws a visible greeting while music continues')
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  await add(1, 'Pausa de saludos')
  await admin.getByRole('button', { name: 'Pausar saludos', exact: true }).click()
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect.poll(() => records().at(-1).status).toBe('SKIPPED')
  await expect(overlay).toHaveCount(0)
  await admin.getByRole('button', { name: 'Reanudar saludos', exact: true }).click()
  await expect.poll(() => db.prepare('SELECT status FROM queue ORDER BY queueId DESC LIMIT 1').get().status, { timeout: 10000 }).toBe('PLAYED')
  assert.equal(records().at(-1).status, 'SKIPPED')
  pass('Paused publication skips the opening rather than publishing late or holding music')
  // Fill the next two-song turn before starting it.
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  const plainRequest = await emit(guestSocket, 'server/QUEUE_ADD', { source: 'LOCAL', songId: 2, requestId: crypto.randomUUID() })
  await expect(songCard(plainRequest.payload.queueId)).toBeVisible()
  await expect(songCard(plainRequest.payload.queueId).getByRole('group', { name: 'Saludo', exact: true })).toHaveCount(0)
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT status FROM queue ORDER BY queueId DESC LIMIT 1').get().status, { timeout: 10000 }).toBe('PLAYED')
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  await add(1, 'Interrumpido por reconexión')
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect(overlay).toContainText('Interrumpido por reconexión')
  await player.reload()
  await expect.poll(() => records().at(-1).status).toBe('INTERRUPTED')
  await expect(overlay).toHaveCount(0)
  const secondPlayer = await adminContext.newPage()
  await secondPlayer.goto(`${base}player`)
  await expect(secondPlayer.getByRole('heading', { name: 'Ya hay un reproductor activo' })).toBeVisible()
  await expect(secondPlayer.getByTestId('greeting-overlay')).toHaveCount(0)
  pass('Reload and duplicate player never re-emit an interrupted turn')
  assert.deepEqual(errors, [])
  console.log(`All greetings checks passed (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS participant frontend / isolated API' : ''}). Artifacts: ${data}`)
} catch (error) {
  for (const [name, page] of [['guest', guest], ['admin', admin], ['player', player]]) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, `failure-${name}.png`) }).catch(() => {})
  }
  throw error
} finally {
  sockets.forEach(sock => sock.disconnect())
  await browser?.close()
  await guestApi?.dispose()
  db?.close()
  await api.dispose()
  await stop()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
  console.log(`Artifacts: ${data}`)
}
