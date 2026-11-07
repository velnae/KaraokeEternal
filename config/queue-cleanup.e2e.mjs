import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-queue-cleanup-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const otherApi = await request.newContext()
const sockets = []
const errors = []
let server, browser, db
let closing = false
let dropCleanupAck = false
const cleanupRequests = []
const pass = name => console.log(`PASS ${name}`)
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  const entry = development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']
  server = spawn(process.execPath, [...entry, '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false' },
  })
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for the isolated server. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Isolated server unavailable')
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const ended = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await ended
}
const connect = async (context) => {
  const cookie = (await context.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  const socket = io(origin, { path: '/karaoke/socket.io', extraHeaders: { cookie }, transports: ['websocket'], autoConnect: false })
  sockets.push(socket)
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}
const emit = async (socket, type, payload = {}) => {
  const reply = await socket.timeout(5000).emitWithAck('action', { type, payload })
  assert.ok(!reply.error, reply.error)
  return reply
}
const add = async (socket, songId, origin = 'PARTICIPANT') => (await emit(socket, 'server/QUEUE_ADD', { songId, origin, requestId: crypto.randomUUID() })).payload.queueId
const pendingCount = () => db.prepare('SELECT count(*) n FROM queue WHERE roomId=1 AND status IN (\'APPROVED\',\'PENDING_APPROVAL\')').get().n
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=5', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call('setup', { username: 'admin', newPassword: 'cleanup-test-password', newPasswordConfirm: 'cleanup-test-password', name: 'Operator' })
  const room = (await call('rooms/1')).entities[1]
  await call('rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OFF' }, queue: { approvalMode: 'MANUAL', houseTracksBeforeParticipant: 1 } } }, 'PUT')
  await call('rooms', { name: 'Other room', status: 'open', prefs: {} })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Artist\',\'artist\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Current song\',\'current song\'),(2,1,\'Pending song\',\'pending song\'),(3,1,\'Old song\',\'old song\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',60,1),(2,2,1,\'song.mp4\',60,1),(3,3,1,\'song.mp4\',60,1)')
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'cleanup-test-password', roomId: 1 })
  const adminSocket = await connect(api)
  const oldPlayed = await add(adminSocket, 3)
  const oldFailed = await add(adminSocket, 3)
  db.prepare('UPDATE queue SET status=\'PLAYED\' WHERE queueId=?').run(oldPlayed)
  db.prepare('UPDATE queue SET status=\'FAILED\' WHERE queueId=?').run(oldFailed)
  let currentId = await add(adminSocket, 1)
  await add(adminSocket, 2)
  await add(adminSocket, 2, 'OPERATOR')
  await add(adminSocket, 2, 'HOUSE')
  const list = await call('rooms/1/playlists', { name: 'Daily music' })
  await call(`rooms/1/playlists/${list.createdPlaylistId}/items`, { source: 'LOCAL', sourceId: '2' })
  await call('rooms/1/playlists/playback', { playlistId: list.createdPlaylistId, enabled: true, repeat: true }, 'PUT')
  assert.equal((await otherApi.post(`${base}api/login`, { data: { username: 'admin', password: 'cleanup-test-password', roomId: 2 } })).status(), 200)
  const otherSocket = await connect(otherApi)
  const otherId = await add(otherSocket, 2)

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  if (httpsUi) {
    // Load tunnel assets but keep commands, data and playback in the isolated room.
    const forward = async (route, isSocket = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = isSocket ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const body = incoming.postData()
      if (isSocket && body?.includes('"type":"server/QUEUE_CLEANUP"')) {
        for (const packet of body.split('\x1e')) {
          if (packet.includes('"type":"server/QUEUE_CLEANUP"')) cleanupRequests.push(JSON.parse(packet.slice(packet.indexOf('[')))[1].payload)
        }
      }
      try {
        const response = await api.fetch(base + suffix, { method: incoming.method(), data: incoming.postDataBuffer() ?? undefined,
          headers: { 'accept-encoding': 'identity', ...(incoming.headers()['content-type'] ? { 'content-type': incoming.headers()['content-type'] } : {}) } })
        if (isSocket && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else if (isSocket && dropCleanupAck && (await response.text()).includes('"type":"server/QUEUE_CLEANUP_SUCCESS"')) {
          dropCleanupAck = false
          const remaining = (await response.text()).split('\x1e').filter(packet => !packet.includes('"type":"server/QUEUE_CLEANUP_SUCCESS"')).join('\x1e')
          await route.fulfill({ response, body: remaining || '6' })
        } else await route.fulfill({ response })
      } catch (error) {
        if (!closing) errors.push(error.message)
        await route.abort().catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  await context.addInitScript(() => {
    const Original = window.WebSocket
    window.cleanupRequests = []
    window.dropCleanupAck = false
    window.WebSocket = class extends Original {
      constructor (...args) {
        super(...args)
        this.addEventListener('message', (event) => {
          if (window.dropCleanupAck && typeof event.data === 'string' && event.data.includes('"type":"server/QUEUE_CLEANUP_SUCCESS"')) {
            window.dropCleanupAck = false
            event.stopImmediatePropagation()
          }
        })
      }

      send (data) {
        if (typeof data === 'string' && data.includes('"type":"server/QUEUE_CLEANUP"')) {
          window.cleanupRequests.push(JSON.parse(data.slice(data.indexOf('[')))[1].payload)
        }
        super.send(data)
      }
    }
  })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const admin = await context.newPage()
  await admin.goto(`${uiBase}account?roomId=1`)
  await expect(admin.getByRole('heading', { name: room.name, exact: true })).toBeVisible()
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('cleanup-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${uiBase}queue`)
  const player = await context.newPage()
  await player.goto(`${uiBase}player`)
  const transport = player.getByRole('toolbar', { name: 'Controles de reproducción' })
  await transport.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE roomId=1 AND status=\'PLAYING\'').get().n).toBe(1)
  currentId = db.prepare('SELECT queueId FROM queue WHERE roomId=1 AND status=\'PLAYING\'').get().queueId
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true)
  await player.evaluate(() => {
    window.currentVideo = document.querySelector('video')
  })

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await guestContext.newPage()
  guest.on('pageerror', error => errors.push(error.message))
  await guest.goto(`${base}account?roomId=1`)
  await guest.getByLabel('Tu nombre').fill('Cleanup singer')
  await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(guest).toHaveURL(`${base}library`)
  const guestSocket = await connect(guestContext)
  const guestRequest = await add(guestSocket, 2)
  const rejected = await guestSocket.timeout(5000).emitWithAck('action', { type: 'server/QUEUE_CLEANUP', payload: { operation: 'pending', confirmed: true, throughQueueId: 9999, requestId: crypto.randomUUID(), expiresAt: Date.now() + 15000, roomId: 2 } })
  assert.ok(rejected.error?.includes('administradores'))
  await guest.goto(`${base}requests`)
  await expect(guest.getByRole('heading', { name: 'Pending song', exact: true })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Vaciar cola', exact: true })).toHaveCount(0)
  pass('Participants cannot clear queues and still see their pending request')

  // History-only cleanup preserves both paused media and future requests.
  await transport.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
  const controls = admin.getByRole('region', { name: 'Limpieza de la cola' })
  await controls.getByRole('button', { name: 'Limpiar historial', exact: true }).click()
  const historyDialog = admin.getByRole('dialog', { name: 'Limpiar historial', exact: true })
  await historyDialog.getByRole('button', { name: 'Limpiar historial', exact: true }).click()
  await expect(historyDialog).toBeHidden()
  await expect(admin.locator(`[data-queue-id="${oldPlayed}"]`)).toHaveCount(0)
  await expect(admin.locator(`[data-queue-id="${oldFailed}"]`)).toHaveCount(0)
  await expect(admin.locator(`[data-queue-id="${currentId}"]`)).toBeVisible()
  assert.ok(await player.evaluate(() => document.querySelector('video') === window.currentVideo && window.currentVideo.paused))
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(oldPlayed).status, 'PLAYED')
  assert.ok(db.prepare('SELECT historyClearedAt FROM queue WHERE queueId=?').get(oldPlayed).historyClearedAt)
  await admin.reload()
  await expect(admin.locator(`[data-queue-id="${currentId}"]`)).toBeVisible()
  await expect(admin.locator(`[data-queue-id="${oldPlayed}"]`)).toHaveCount(0)
  pass('History cleanup hides completed rows persistently without changing paused playback or pending requests')
  await transport.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused)).toBe(true)

  const countBefore = pendingCount()
  await admin.getByRole('button', { name: /^Por aprobar/ }).click()
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  const clearDialog = admin.getByRole('dialog', { name: '¿Vaciar completamente la cola?', exact: true })
  await expect(clearDialog).toContainText('Se detendrá la reproducción y se quitarán todas las canciones de esta cola, incluido el historial visible. Tus listas guardadas se conservarán.')
  await expect(clearDialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
  await admin.keyboard.press('Escape')
  assert.equal(pendingCount(), countBefore)
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.screenshot({ path: path.join(data, `clear-confirm-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await clearDialog.getByRole('button', { name: 'Vaciar cola', exact: true }).focus()
  await player.evaluate(() => {
    window.timeBeforeCleanup = window.currentVideo.currentTime
  })
  await admin.keyboard.press('Enter')
  await expect(clearDialog).toBeHidden()
  await expect.poll(pendingCount).toBe(0)
  await expect(controls.getByRole('status')).toContainText('Cola vaciada completamente. Reproducción detenida.')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(guestRequest).status, 'REMOVED')
  await expect(guest.getByRole('heading', { name: 'Pending song', exact: true })).toHaveCount(0)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(otherId).status, 'APPROVED')
  assert.equal((await call('rooms/1/playlists')).playback.enabled, false)
  assert.equal(db.prepare('SELECT count(*) n FROM musicPlaylistItems').get().n, 1)
  await player.waitForTimeout(1200)
  assert.equal(pendingCount(), 0)
  await expect(player.locator('video')).toHaveCount(0)
  assert.ok(await player.evaluate(() => window.currentVideo.paused))
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(currentId).status, 'REMOVED')
  await admin.getByRole('button', { name: 'Cola', exact: true }).click()
  await expect(admin.locator('[data-queue-id]')).toHaveCount(0)
  await expect(transport.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()
  await admin.reload()
  await expect(admin.getByRole('heading', { name: 'La cola de reproducción está vacía' })).toBeVisible()
  pass('Full clear stops active media, empties the visible queue, disables house refill and preserves saved lists and other rooms')

  const pausedId = await add(adminSocket, 1, 'OPERATOR')
  await expect(player.locator('video')).toHaveCount(0)
  await transport.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(pausedId).status).toBe('PLAYING')
  await transport.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await clearDialog.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await expect(clearDialog).toBeHidden()
  await expect(player.locator('video')).toHaveCount(0)
  await expect(admin.locator('[data-queue-id]')).toHaveCount(0)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(pausedId).status, 'REMOVED')
  pass('Full clear removes a paused current song as well; new requests wait for explicit playback')

  const uncertainId = await add(adminSocket, 2)
  await expect(admin.locator(`[data-queue-id="${uncertainId}"]`)).toBeVisible()
  if (httpsUi) dropCleanupAck = true
  else await admin.evaluate(() => {
    window.dropCleanupAck = true
  })
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await clearDialog.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await expect(clearDialog.getByRole('button', { name: 'Comprobar resultado', exact: true })).toBeVisible({ timeout: 15000 })
  const originalRequest = httpsUi ? cleanupRequests.at(-1) : await admin.evaluate(() => window.cleanupRequests.at(-1))
  assert.equal(originalRequest.checkOnly, false)
  const newRequest = await add(adminSocket, 2)
  await admin.reload()
  await controls.getByRole('button', { name: 'Comprobar resultado', exact: true }).click()
  await clearDialog.getByRole('button', { name: 'Comprobar resultado', exact: true }).click()
  await expect(clearDialog).toBeHidden()
  const checked = httpsUi ? cleanupRequests.at(-1) : await admin.evaluate(() => window.cleanupRequests.at(-1))
  assert.equal(checked.requestId, originalRequest.requestId)
  assert.equal(checked.checkOnly, true)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(newRequest).status, 'APPROVED')
  await expect(admin.locator(`[data-queue-id="${newRequest}"]`)).toBeVisible()
  pass('Lost acknowledgment survives reload and check-only recovery does not clear a later request')

  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.screenshot({ path: path.join(data, `queue-clean-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  assert.deepEqual(errors, [])
  console.log(`Evidence: ${data}`)
} catch (error) {
  console.error(`Evidence retained: ${data}`, errors)
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error(page.url(), await page.locator('body').innerText().catch(() => 'unavailable'))
  throw error
} finally {
  closing = true
  sockets.forEach(socket => socket.disconnect())
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  await otherApi.dispose()
  fs.closeSync(log)
}
