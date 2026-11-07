import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync('/tmp/opencode/queue-fairness-')
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const guestApi = await request.newContext()
let server, browser, db, socket
const pages = []
let playerStatus = {}
let closing = false
const errors = []
const call = async (client, endpoint, body, method = 'POST') => {
  const response = await client.fetch(`${base}api/${endpoint}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_YOUTUBE_API_KEY: '', KES_ELEVENLABS_API_KEY: '', KES_GEMINI_API_KEY: '' },
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
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exited
}
const emit = async (type, payload = {}) => {
  const reply = await socket.timeout(10000).emitWithAck('action', { type, payload })
  assert.ok(!reply.error, reply.error)
  return reply
}
const contextFor = async (client, viewport) => {
  const context = await browser.newContext({ storageState: await client.storageState(), viewport })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  if (httpsUi) {
    // Use real tunnel-served assets and isolated authenticated APIs: shared room
    // playback and data must never receive automated test commands.
    const forward = async (route, isSocket = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = isSocket ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      try {
        const response = await client.fetch(base + suffix, { method: incoming.method(), data: incoming.postDataBuffer() ?? undefined,
          headers: { 'accept-encoding': 'identity', ...(incoming.headers()['content-type'] ? { 'content-type': incoming.headers()['content-type'] } : {}) } })
        if (isSocket && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch (error) {
        if (!closing) errors.push(`${url.pathname}: ${error.message.split('\n')[0]}`)
        await route.abort().catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', connection => connection.close())
  }
  return context
}
try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=5',
    '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '120', '-c:v', 'libx264', '-threads', '2',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call(api, 'setup', { username: 'admin', name: 'Operator', newPassword: 'fairness-test-password', newPasswordConfirm: 'fairness-test-password' })
  await call(api, 'rooms/1', { name: 'Fairness test', status: 'open', prefs: { tables: { mode: 'OFF' }, roles: { 4: { allowNew: true } },
    queue: { approvalMode: 'AUTO', rotationMode: 'FAIR', houseTracksBeforeParticipant: 2, maxPendingPerParticipant: 2 } } }, 'PUT')
  const guest = await call(guestApi, 'user', { role: 'guest', name: 'Juan', roomId: 1 })
  await stop()
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  let juanId = guest.userId ?? db.prepare('SELECT userId FROM users WHERE name=?').get('Juan').userId
  db.exec(`INSERT INTO users(userId,username,password,name,roleId) VALUES(99,'new-singer','','New singer',4); INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,'Test song','test song')`)
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec(`INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,'song.mp4',120,1)`)
  const now = Math.floor(Date.now() / 1000)
  const add = (userId, title, origin, status, created) => Number(db.prepare(`INSERT INTO queue(roomId,userId,songId,prevQueueId,source,title,artistOrChannel,origin,status,dateCreated,dateUpdated,durationSeconds,requestIntent)
    VALUES(1,?,1,(SELECT max(queueId) FROM queue),'LOCAL',?,'Fixture',?,?,?,?,120,'LISTEN')`).run(userId, title, origin, status, created, created).lastInsertRowid)
  for (let index = 0; index < 12; index++) add(1, `Earlier house ${index}`, 'HOUSE', 'PLAYED', now - 600 + index)
  add(1, 'Earlier customer', 'PARTICIPANT', 'PLAYED', now - 300)
  const house1 = add(1, 'House one', 'HOUSE', 'APPROVED', now - 200)
  const house2 = add(1, 'House two', 'HOUSE', 'APPROVED', now - 200)
  const first = add(juanId, 'Juan first', 'PARTICIPANT', 'APPROVED', now - 180)
  const second = add(juanId, 'Juan second', 'PARTICIPANT', 'APPROVED', now - 170)
  await start()
  await call(api, 'login', { username: 'admin', password: 'fairness-test-password', roomId: 1 })
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(base.replace('/karaoke/', ''), { path: '/karaoke/socket.io', extraHeaders: { cookie }, transports: ['websocket'] })
  socket.on('action', (action) => {
    if (action.type === 'status/PLAYER_STATUS') playerStatus = action.payload
  })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const adminContext = await contextFor(api, { width: 1440, height: 1000 })
  await guestApi.get(`${base}api/logout`)
  const guestContext = await contextFor(guestApi, { width: 390, height: 844 })
  const admin = await adminContext.newPage()
  const participant = await guestContext.newPage()
  const player = await adminContext.newPage()
  pages.push(admin, participant, player)
  await admin.goto(`${uiBase}account?roomId=1`)
  await expect(admin.getByRole('heading', { name: 'Fairness test', exact: true })).toBeVisible()
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('fairness-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await participant.goto(`${uiBase}account?roomId=1`)
  await participant.getByLabel('Tu nombre').fill('Juan')
  await participant.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(participant).toHaveURL(`${uiBase}library`)
  const identityResponse = await (httpsUi ? guestApi : guestContext.request).get(`${base}api/user`)
  const identity = await identityResponse.json()
  db.prepare('UPDATE queue SET userId=? WHERE userId=?').run(identity.userId, juanId)
  juanId = identity.userId
  await admin.goto(`${uiBase}queue`)
  await participant.goto(`${uiBase}requests`)
  await player.goto(`${uiBase}player`)
  await expect.poll(() => playerStatus.queueId, { timeout: 20000 }).toBe(-1)
  await player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
  const rows = admin.locator('[data-queue-id]')
  let previouslyPlaying
  const playing = async (id) => {
    await expect.poll(() => playerStatus.queueId, { timeout: 15000 }).toBe(id)
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(id).status).toBe('PLAYING')
    await expect.poll(() => player.locator('video').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true)
    await expect(rows.first()).toHaveAttribute('data-queue-id', String(id))
    await expect(admin.locator(`[data-queue-id="${id}"]`)).toHaveCount(1)
    if (previouslyPlaying) await expect(rows.last()).toHaveAttribute('data-queue-id', String(previouslyPlaying))
    previouslyPlaying = id
  }
  await playing(house1)
  await expect.poll(() => playerStatus.nextUserId).toBe(juanId)
  const newcomer = add(99, 'New singer request', 'PARTICIPANT', 'APPROVED', Math.floor(Date.now() / 1000))
  await emit('server/QUEUE_APPROVE', { queueId: newcomer })
  await expect(admin.getByText(/Música de la casa en espera/)).toBeVisible()
  await expect(participant.locator(`[data-queue-id="${first}"]`)).toContainText('Próximo turno de cliente')
  await expect(participant.locator(`[data-queue-id="${second}"]`)).toContainText('2 turnos por delante')
  await expect(participant.locator('article[data-queue-id]').first()).toHaveAttribute('data-queue-id', String(first))
  const nowPlaying = admin.locator(`[data-queue-id="${house1}"]`)
  await expect(rows.nth(1)).toHaveAttribute('data-queue-id', String(first))
  await expect(admin.getByRole('region', { name: 'Reproducción actual', exact: true })).toHaveCount(0)
  await expect(admin.getByRole('region', { name: 'Siguiente en la rotación', exact: true })).toHaveCount(0)
  await expect(admin.locator('summary').filter({ hasText: /^Historial/ })).toHaveCount(0)
  assert.ok(await rows.evaluateAll(items => items.every(item => item.parentElement === items[0].parentElement)))
  await nowPlaying.getByRole('button', { name: 'Más acciones', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect(nowPlaying.getByRole('button', { name: 'Volver a reproducir canción', exact: true })).toBeVisible()
  await nowPlaying.getByRole('button', { name: 'Menos acciones', exact: true }).press('Enter')
  await admin.getByRole('button', { name: 'Por aprobar (0)', exact: true }).click()
  await expect(rows).toHaveCount(0)
  await admin.getByRole('button', { name: 'Cola', exact: true }).click()
  await admin.getByLabel('Filtrar por mesa').selectOption('none')
  await expect(nowPlaying).toContainText('House one')
  await expect(rows.nth(1)).toContainText('Juan first')
  await admin.getByLabel('Filtrar por mesa').selectOption('all')
  const scrollQueue = async bottom => nowPlaying.evaluate((element, bottom) => {
    let scroller = element.parentElement
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement
    if (!scroller) throw new Error('Queue scroll container missing')
    scroller.scrollTop = bottom ? scroller.scrollHeight : 0
  }, bottom)
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 844 })
    await scrollQueue(false)
    await expect.poll(async () => {
      const upcoming = await admin.locator(`[data-queue-id="${house2}"]`).boundingBox()
      const current = await nowPlaying.boundingBox()
      return Math.abs(upcoming.x - current.x) < 1
    }).toBe(true)
    await admin.screenshot({ path: path.join(data, `operator-top-${width}.png`) })
    await scrollQueue(true)
    await expect.poll(async () => (await nowPlaying.boundingBox()).y).toBeLessThan(0)
    await admin.screenshot({ path: path.join(data, `operator-scrolled-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await scrollQueue(false)
  console.log('PASS original cards share one continuous queue: current first, upcoming next, completed last, with no dock or history accordion')
  await participant.reload()
  await expect(participant.locator(`[data-queue-id="${first}"]`)).toContainText('Próximo turno de cliente')
  for (const width of [390, 1440]) {
    await participant.setViewportSize({ width, height: 900 })
    await participant.screenshot({ path: path.join(data, `requests-${width}.png`), fullPage: true })
    assert.ok(await participant.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await emit('server/PLAYER_REQ_NEXT')
  await playing(first)
  await expect.poll(() => rows.first().evaluate(element => element.parentElement.scrollTop)).toBe(0)
  // Aging suppresses filler even after demand drops from three requests to two.
  db.prepare('UPDATE queue SET dateCreated=? WHERE queueId=?').run(now - 610, second)
  await emit('server/QUEUE_APPROVE', { queueId: second })
  await emit('server/PLAYER_REQ_NEXT')
  await playing(newcomer)
  await emit('server/PLAYER_REQ_NEXT')
  await playing(second)
  await emit('server/PLAYER_REQ_NEXT')
  await playing(house2)
  console.log('PASS reserved turn across house playback, newcomer fairness, one song per customer, aging, house resumption and reconnect')

  const failed = add(juanId, 'Failed request', 'PARTICIPANT', 'FAILED', now - 900)
  // A read page refresh fetches the new isolated fixture.
  await participant.reload()
  await expect(participant.locator(`[data-queue-id="${failed}"]`)).toContainText('conservando la antigüedad')
  const replace = participant.getByRole('link', { name: 'Buscar otra versión' })
  await replace.focus()
  await participant.keyboard.press('Enter')
  await expect(participant).toHaveURL(new RegExp(`replace=${failed}`))
  await expect(participant.getByText(/Conservaremos la antigüedad/)).toBeVisible()
  await admin.reload()
  const retry = admin.locator(`[data-queue-id="${failed}"]`).getByRole('button', { name: 'Reintentar conservando la antigüedad' })
  await retry.focus()
  await admin.keyboard.press('Enter')
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE replacesQueueId=?').get(failed).n).toBe(1)
  const recovered = db.prepare('SELECT * FROM queue WHERE replacesQueueId=?').get(failed)
  assert.equal(recovered.userId, juanId)
  assert.equal(recovered.dateCreated, now - 900)
  await participant.goto(`${uiBase}requests`)
  await expect(participant.locator(`[data-queue-id="${failed}"]`)).toContainText('Ya elegiste un reemplazo')
  await expect(retry).toHaveCount(0)
  await emit('server/PLAYER_REQ_NEXT')
  await playing(recovered.queueId)
  // The same HTTPS operator session prepares a repertoire before activating it.
  db.exec('INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(2,1,\'Second saved song\',\'second saved song\'); INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(2,2,1,\'song.mp4\',120,1)')
  const created = await call(api, 'rooms/1/playlists', { name: 'Operator mix' })
  const listId = created.createdPlaylistId
  for (const id of [1, 2]) await call(api, `rooms/1/playlists/${listId}/items`, { source: 'LOCAL', sourceId: String(id) })
  await admin.goto(`${uiBase}admin/playlists?list=${listId}`)
  const shuffle = admin.getByRole('button', { name: 'Mezclar y guardar', exact: true })
  await shuffle.focus()
  await admin.keyboard.press('Enter')
  await expect(admin.getByText('Orden mezclado y guardado. Al activar la lista, comenzará en este orden y lo conservará al repetir.', { exact: true })).toBeVisible()
  const saved = (await call(api, 'rooms/1/playlists', undefined, 'GET')).playlists.find(list => list.playlistId === listId)
  await admin.reload()
  await expect(admin.getByRole('list', { name: 'Canciones de la lista' }).getByRole('listitem').first()).toContainText(saved.items[0].song.title)
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 844 })
    await shuffle.scrollIntoViewIfNeeded()
    const buttonBounds = await shuffle.boundingBox()
    const songsBounds = await admin.getByRole('list', { name: 'Canciones de la lista' }).boundingBox()
    assert.ok(buttonBounds.y + buttonBounds.height <= songsBounds.y, 'Whole-list shuffle must precede song rows')
    await admin.screenshot({ path: path.join(data, `shuffle-${width}.png`) })
  }
  await call(api, 'rooms/1/playlists/playback', { playlistId: listId, enabled: true, repeat: true }, 'PUT')
  await shuffle.click()
  await expect(admin.getByRole('alert')).toContainText('Desactiva la lista')
  await admin.reload()
  await expect(shuffle).toBeDisabled()
  await expect(admin.getByText('Desactiva la lista en De la casa antes de mezclarla. La canción actual continuará.', { exact: true })).toBeVisible()
  assert.deepEqual((await call(api, 'rooms/1/playlists', undefined, 'GET')).playlists.find(list => list.playlistId === listId).items, saved.items)
  console.log('PASS keyboard playlist shuffle persists; concurrent activation rejects another shuffle and explains recovery')
  assert.deepEqual(errors, [])
  console.log(`PASS keyboard recovery preserves waiting time and owner; ${development ? 'development StrictMode' : 'production'}${httpsUi ? ' with HTTPS assets + isolated APIs' : ''}; evidence: ${data}`)
} catch (error) {
  console.error('Player status:', playerStatus, 'Page errors:', errors)
  for (const [index, page] of pages.entries()) {
    console.error(page.url(), await page.locator('body').innerText().catch(() => 'Page unavailable'))
    await page.screenshot({ path: path.join(data, `failure-${index}.png`) }).catch(() => {})
  }
  throw error
} finally {
  closing = true
  socket?.disconnect()
  await browser?.close()
  await api.dispose()
  await guestApi.dispose()
  db?.close()
  await stop()
  fs.closeSync(log)
  console.log(`Artifacts: ${data}`)
}
