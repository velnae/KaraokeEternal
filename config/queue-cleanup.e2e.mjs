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
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-queue-cleanup-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const api = await request.newContext()
const otherApi = await request.newContext()
const sockets = []
const errors = []
let server, browser, db
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

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
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
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('cleanup-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${base}queue`)
  const player = await context.newPage()
  await player.goto(`${base}player`)
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

  const countBefore = pendingCount()
  await admin.getByRole('button', { name: /^Por aprobar/ }).click()
  const controls = admin.getByRole('region', { name: 'Limpieza de la cola' })
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  const clearDialog = admin.getByRole('dialog', { name: 'Vaciar cola', exact: true })
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
  await expect(controls.getByRole('status')).toContainText('Se quitaron')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(guestRequest).status, 'REMOVED')
  await expect(guest.getByRole('heading', { name: 'Pending song', exact: true })).toHaveCount(0)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(otherId).status, 'APPROVED')
  assert.equal((await call('rooms/1/playlists')).playback.enabled, false)
  assert.equal(db.prepare('SELECT count(*) n FROM musicPlaylistItems').get().n, 1)
  await player.waitForTimeout(1200)
  assert.equal(pendingCount(), 0)
  assert.ok(await player.evaluate(() => document.querySelector('video') === window.currentVideo && !window.currentVideo.paused && window.currentVideo.currentTime >= window.timeBeforeCleanup))
  pass('Confirmed clear removes all pending origins across tabs, disables house refill and preserves current audio, lists and other room')
  await transport.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)

  await admin.getByRole('button', { name: 'Cola', exact: true }).click()
  await expect(admin.locator(`[data-queue-id="${oldPlayed}"]`)).toBeVisible()
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
  pass('History cleanup hides completed rows persistently without deleting receipts or changing paused playback')

  const uncertainId = await add(adminSocket, 2)
  await expect(admin.locator(`[data-queue-id="${uncertainId}"]`)).toBeVisible()
  await admin.evaluate(() => {
    window.dropCleanupAck = true
  })
  await controls.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await clearDialog.getByRole('button', { name: 'Vaciar cola', exact: true }).click()
  await expect(clearDialog.getByRole('button', { name: 'Comprobar resultado', exact: true })).toBeVisible({ timeout: 15000 })
  const originalRequest = await admin.evaluate(() => window.cleanupRequests.at(-1))
  assert.equal(originalRequest.checkOnly, false)
  const newRequest = await add(adminSocket, 2)
  await admin.reload()
  await controls.getByRole('button', { name: 'Comprobar resultado', exact: true }).click()
  await clearDialog.getByRole('button', { name: 'Comprobar resultado', exact: true }).click()
  await expect(clearDialog).toBeHidden()
  const checked = await admin.evaluate(() => window.cleanupRequests.at(-1))
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
  sockets.forEach(socket => socket.disconnect())
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  await otherApi.dispose()
  fs.closeSync(log)
}
