import { chromium, request, expect } from 'playwright/test'
import { io } from 'socket.io-client'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const https = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const httpsOrigin = 'https://dev-karaoke.puyu.pe'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-access-'))
const log = fs.openSync(path.join(directory, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const uiBase = https ? `${httpsOrigin}/karaoke/` : base
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KES_|KARAOKE_|DEV_PLAYER_|NODE_OPTIONS$)/.test(key)))
const server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', directory, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
  cwd: root, stdio: ['ignore', log, log], env: { ...env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false' },
})
const contexts = []
const sockets = []
const pages = []
const errors = []
const checks = []
let browser, db
const apiFor = async () => {
  const api = await request.newContext()
  contexts.push(api)
  return api
}
const admin = await apiFor()
const call = async (api, endpoint, body, method = body === undefined ? 'GET' : 'POST', status = 200) => {
  const response = await api.fetch(`${base}api/${endpoint}`, { method, data: body })
  assert.equal(response.status(), status, `${method} ${endpoint}: ${await response.text()}`)
  return status === 200 ? response.json() : null
}
const pass = (message) => {
  checks.push(message)
  console.log(`PASS ${message}`)
}
const connect = async (api) => {
  const cookie = (await api.storageState()).cookies.map(item => `${item.name}=${item.value}`).join('; ')
  const socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, reconnection: false, autoConnect: false })
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
    socket.connect()
  })
  return socket
}
const command = (socket, type, payload = {}) => socket.timeout(5000).emitWithAck('action', { type, payload })
const pageFor = async (api, identity) => {
  const context = await browser.newContext({ storageState: https ? undefined : await api.storageState(), viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((user) => {
    localStorage.setItem('persist:user', JSON.stringify(Object.fromEntries(Object.entries(user).map(([key, value]) => [key, JSON.stringify(value)]))))
  }, identity)
  if (https) {
    // Exercise this worktree on an HTTPS origin, forwarding only to isolated data.
    // Shared development assets are a different checkout and are not a release test.
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
    await context.route(`${httpsOrigin}/**`, async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      if (url.pathname.includes('__webpack_hmr')) return route.abort()
      const headers = { 'accept-encoding': 'identity' }
      for (const key of ['content-type', 'range']) if (incoming.headers()[key]) headers[key] = incoming.headers()[key]
      try {
        const response = await api.fetch(`${origin}${url.pathname}${url.search}`, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (url.pathname.includes('/socket.io/') && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.ok()) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          return route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        }
        await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    })
  }
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  pages.push(page)
  return page
}
const stored = key => JSON.parse(db.prepare('SELECT data FROM prefs WHERE key=?').get(key).data)
const installPlaybackFixture = async (context) => {
  await context.route('**/staff-playback.webm', route => route.fulfill({ path: path.join(directory, 'playback.webm'), contentType: 'video/webm' }))
  await context.addInitScript(() => {
    window.YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
      Player: class {
        constructor (target, options) {
          this.options = options
          this.video = document.createElement('video')
          this.video.style.cssText = 'width:100%;height:100%'
          target.replaceChildren(this.video)
          for (const [name, state] of [['playing', 1], ['pause', 2], ['ended', 0]]) {
            this.video.addEventListener(name, () => {
              if (state !== 2 || !this.video.ended) options.events.onStateChange({ target: this, data: state })
            })
          }
          queueMicrotask(() => options.events.onReady({ target: this }))
        }

        loadVideoById (id) {
          this.id = id
          this.video.src = new URL('staff-playback.webm', document.baseURI).href
          this.playVideo()
        }

        cueVideoById (id) {
          this.id = id
          this.video.src = new URL('staff-playback.webm', document.baseURI).href
          queueMicrotask(() => this.options.events.onStateChange({ target: this, data: 5 }))
        }

        playVideo () { void this.video.play().catch(() => this.options.events.onAutoplayBlocked?.({ target: this })) }
        pauseVideo () { this.video.pause() }
        seekTo (seconds) { this.video.currentTime = seconds }
        getCurrentTime () { return this.video.currentTime }
        getVideoUrl () { return `https://www.youtube.com/watch?v=${this.id}` }
        setVolume (volume) { this.video.volume = volume / 100 }
        setSize () {}
        destroy () {
          this.video.pause()
          this.video.remove()
        }
      },
    }
  })
}

try {
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. See ${directory}`)
    try {
      return (await admin.get(`${base}api/prefs`)).status()
    } catch { return 0 }
  }, { timeout: 120000 }).toBe(200)
  if (https) {
    const response = await fetch(httpsOrigin, { signal: AbortSignal.timeout(15000) })
    assert.ok(response.ok, 'development HTTPS tunnel is reachable')
  }
  const adminIdentity = await call(admin, 'setup', { username: 'admin', name: 'Technical admin', newPassword: 'staff-access-test', newPasswordConfirm: 'staff-access-test' })
  const roles = {}
  for (const role of ['operator', 'manager', 'standard']) {
    await call(admin, 'user', { username: role, name: role, role, newPassword: 'staff-access-test', newPasswordConfirm: 'staff-access-test' })
    const api = await apiFor()
    const identity = await call(api, 'login', { username: role, password: 'staff-access-test', roomId: 1 })
    assert.equal(identity.role, role)
    assert.equal(identity.isAdmin, false)
    roles[role] = { api, identity }
  }
  db = new DatabaseSync(path.join(directory, 'database.sqlite3'))
  db.exec(`INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,'Local fixture','local fixture');`)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '30', path.join(directory, 'fixture.mp3')])
  fs.writeFileSync(path.join(directory, 'fixture.cdg'), Buffer.alloc(30 * 300 * 24))
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(directory, '{"prefs":{"isWatchingEnabled":false}}')
  db.exec(`INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,'fixture.mp3',30,1)`)
  const table = await call(admin, 'rooms/1/tables', { code: '1', name: 'Mesa 1', status: 'active' })
  const tableId = table.tables?.[0]?.tableId ?? table.result?.[0]
  const id = tableId ?? db.prepare('SELECT tableId FROM roomTables LIMIT 1').get().tableId
  const invitation = (await call(admin, `rooms/1/tables/${id}/qr`)).invitation
  const room = (await call(admin, 'rooms/1')).entities[1]
  await call(admin, 'rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 3: { allowNew: true }, 4: { allowNew: true } }, tables: { mode: 'REQUIRED_QR' }, queue: { approvalMode: 'MANUAL' } } }, 'PUT')
  for (const role of ['operator', 'manager']) {
    const { api, identity } = roles[role]
    await call(api, 'login', { username: role, password: 'staff-access-test', roomId: 1 })
    const prefs = await call(api, 'prefs')
    assert.ok(!('paths' in prefs) && !('greetingVoice' in prefs))
    await call(api, 'users', undefined, 'GET', 401)
    await call(api, 'rooms/1', {}, 'PUT', 401)
    await call(api, 'user', { username: 'escalation', role: 'admin' }, 'POST', 401)
    await call(api, `user/${identity.userId}`, { password: 'staff-access-test', role: 'admin' }, 'PUT', 403)
    await call(api, 'animation/production/jobs', { inputs: [] }, 'POST', 403)
    await call(api, 'animation/resources/upload', {}, 'POST', 403)
    await call(api, 'birthdays/events', {}, 'POST', 403)
    await call(api, 'rooms/1/playlists', { name: 'Forbidden list' }, 'POST', 403)
    await call(api, 'rooms/1/playlists')
    await call(api, 'animation/catalog')
    const socket = await connect(api)
    roles[role].socket = socket
    assert.equal((await command(socket, 'server/PLAYER_REQ_PAUSE')).type, 'server/PLAYER_REQ_PAUSE_SUCCESS')
    assert.ok((await command(socket, 'server/PREFS_SET', { key: 'isReplayGainEnabled', data: false })).error)
    const snapshot = (await command(socket, 'server/ANIMATION_SYNC')).payload
    assert.ok((await command(socket, 'server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, cutoffHour: 0, expiresAt: Date.now() + 5000 })).error)
  }
  const guest = await apiFor()
  const guestIdentity = await call(guest, 'user', { role: 'guest', name: 'Singer', roomId: 1, invitation })
  const guestSocket = await connect(guest)
  await call(roles.standard.api, 'users', undefined, 'GET', 401)
  await call(roles.standard.api, 'prefs/branding', { name: 'Forbidden' }, 'PUT', 403)
  const standardIdentity = await call(roles.standard.api, 'login', { username: 'standard', password: 'staff-access-test', roomId: 1, invitation })
  const standardSocket = await connect(roles.standard.api)
  assert.ok((await command(standardSocket, 'server/PLAYER_REQ_PLAY')).error)
  await call(admin, 'user', { username: 'reserved', name: 'Reserved', role: 'player', newPassword: 'staff-access-test', newPasswordConfirm: 'staff-access-test' }, 'POST', 422)
  db.prepare(`INSERT INTO users(username,password,name,roleId) SELECT 'reserved',password,'Reserved',2 FROM users WHERE username='operator'`).run()
  const reserved = await apiFor()
  const reservedIdentity = await call(reserved, 'login', { username: 'reserved', password: 'staff-access-test', roomId: 1, invitation })
  assert.equal(reservedIdentity.role, 'player')
  const reservedSocket = await connect(reserved)
  assert.ok((await command(reservedSocket, 'server/PLAYER_REQ_PLAY')).error)
  const requestReply = await command(guestSocket, 'server/QUEUE_ADD', { songId: 1, source: 'LOCAL', origin: 'PARTICIPANT', requestIntent: 'SING' })
  assert.ok(!requestReply.error, JSON.stringify(requestReply))
  let queueId = db.prepare('SELECT queueId FROM queue WHERE userId=? ORDER BY queueId DESC LIMIT 1').get(guestIdentity.userId).queueId
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'PENDING_APPROVAL')
  assert.ok((await command(guestSocket, 'server/QUEUE_APPROVE', { queueId })).error)
  assert.ok(!(await command(roles.operator.socket, 'server/QUEUE_APPROVE', { queueId })).error)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'APPROVED')
  for (const role of ['operator', 'manager']) {
    assert.equal((await command(roles[role].socket, 'server/PLAYER_EMIT_STATUS', { queueId: -1, isAtQueueEnd: true, isPlaying: false })).type, 'player/AUTHORITY_GRANTED')
    const snapshot = (await command(roles[role].socket, 'server/ANIMATION_SYNC')).payload
    const enabled = await command(roles[role].socket, 'server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, expiresAt: Date.now() + 5000 })
    assert.ok(!enabled.error, JSON.stringify(enabled))
    const clips = await call(roles[role].api, 'animation/catalog')
    const pending = await command(roles[role].socket, 'server/ANIMATION_REQUEST', { requestId: `staff-${role}`, clipId: clips[0].id, expiresAt: Date.now() + 5000 })
    assert.equal(pending.payload?.active?.status, 'PENDING', JSON.stringify(pending))
    assert.ok(!(await command(roles[role].socket, 'server/ANIMATION_CANCEL', { interventionId: pending.payload.active.interventionId, expiresAt: Date.now() + 5000 })).error)
    await command(roles[role].socket, 'server/ANIMATION_CONTROL', { controlVersion: enabled.payload.controlVersion, enabled: false, expiresAt: Date.now() + 5000 })
    assert.ok(!(await command(roles[role].socket, 'server/QUEUE_MOVE', { queueId, prevQueueId: null })).error)
    assert.equal((await command(guestSocket, 'server/PLAYER_EMIT_STATUS', {})).type, 'server/PLAYER_EMIT_STATUS_ERROR')
    const other = role === 'operator' ? 'manager' : 'operator'
    assert.equal((await command(roles[other].socket, 'server/PLAYER_EMIT_STATUS', {})).type, 'player/AUTHORITY_DENIED')
    await command(roles[role].socket, 'server/PLAYER_EMIT_LEAVE')
  }
  pass('staff operation, prepared announcements, participant QR requests, HTTP/socket denials and single-player authority')

  const operator = roles.operator
  const disconnected = new Promise(resolve => operator.socket.once('disconnect', resolve))
  await call(admin, `user/${operator.identity.userId}`, { role: 'standard' }, 'PUT')
  await disconnected
  assert.equal((await call(operator.api, 'user')).role, 'standard')
  const stale = await connect(operator.api)
  const staleReply = await command(stale, 'server/PLAYER_REQ_PLAY').catch(() => ({ error: 'disconnected' }))
  assert.ok(staleReply.error)
  stale.disconnect()
  await call(admin, `user/${operator.identity.userId}`, { role: 'operator' }, 'PUT')
  operator.identity = await call(operator.api, 'login', { username: 'operator', password: 'staff-access-test', roomId: 1 })
  for (const socket of sockets) socket.disconnect()
  pass('live role downgrade rejects stale cookies and releases existing sockets')
  await call(admin, 'user', { username: 'temporary-admin', name: 'Temporary admin', role: 'admin', newPassword: 'staff-access-test', newPasswordConfirm: 'staff-access-test' })
  const temporary = await apiFor()
  const temporaryIdentity = await call(temporary, 'login', { username: 'temporary-admin', password: 'staff-access-test', roomId: 1 })
  await call(admin, `user/${temporaryIdentity.userId}`, { role: 'operator' }, 'PUT')
  await call(temporary, 'users', undefined, 'GET', 401)
  assert.equal((await call(temporary, 'user')).isAdmin, false)
  await call(admin, `user/${temporaryIdentity.userId}`, undefined, 'DELETE')
  await call(temporary, 'user', undefined, 'GET', 401)
  pass('registered/reserved users remain participants and stale administrator/deleted cookies lose privileges')

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
  await call(admin, 'prefs/branding', { name: 'Fixture venue', logoSrc: png, supportUrl: 'https://example.com/support' }, 'PUT')
  const initialDisplay = (await call(admin, 'prefs')).playerDisplay
  await call(admin, 'prefs/player-display', { ...initialDisplay, announcement: { ...initialDisplay.announcement, backgroundColor: '#123456' } }, 'PUT')
  await call(operator.api, 'prefs/branding', { name: 'Forbidden' }, 'PUT', 403)
  await call(roles.manager.api, 'prefs/branding', { supportUrl: '' }, 'PUT', 403)
  await call(roles.manager.api, 'prefs/player-display', { announcement: { enabled: false } }, 'PUT', 403)
  await call(roles.manager.api, 'prefs/player-display', { logo: { scale: 301 } }, 'PUT', 422)
  const list = await call(admin, 'rooms/1/playlists', { name: 'Prepared list' })
  await call(admin, `rooms/1/playlists/${list.createdPlaylistId}/items`, { source: 'LOCAL', sourceId: '1' })
  await call(operator.api, 'rooms/1/playlists/playback', { playlistId: list.createdPlaylistId, enabled: true, repeat: true }, 'PUT')
  assert.equal((await call(operator.api, 'rooms/1/playlists')).playback.enabled, true)
  await call(operator.api, 'rooms/1/playlists/playback', { playlistId: list.createdPlaylistId, enabled: false, repeat: true }, 'PUT')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(directory, 'background.mp4')])
  const upload = await admin.post(`${base}api/animation/background/upload`, { multipart: {
    requestId: 'staff-background', title: 'Prepared background', file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(directory, 'background.mp4')) },
  } })
  assert.ok([200, 202].includes(upload.status()), await upload.text())
  const video = await upload.json()
  await expect.poll(async () => (await call(admin, `animation/background/videos/${video.id}`)).state).toBe('ready')
  await call(admin, `animation/background/videos/${video.id}`, { active: true }, 'PATCH')
  await call(operator.api, 'animation/background', { videoId: video.id, revision: 0 }, 'PUT', 403)
  await call(roles.manager.api, `animation/background/videos/${video.id}`, undefined, 'DELETE', 403)
  await call(roles.manager.api, 'animation/background', { videoId: video.id, revision: 0, dimOpacity: 0 }, 'PUT', 403)
  assert.equal((await operator.api.head(`${base}api/animation/background/videos/${video.id}/video`)).status(), 200)
  pass('limited personalization rejects protected fields and prepared lists remain usable')

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const operatorPage = await pageFor(operator.api, operator.identity)
  await operatorPage.goto(`${uiBase}queue`)
  await expect(operatorPage.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await expect(operatorPage.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
  await expect(operatorPage.getByRole('link', { name: 'Personalización', exact: true })).toHaveCount(0)
  const queueActions = operatorPage.getByRole('button', { name: 'Acciones de la canción', exact: true }).first()
  await queueActions.focus()
  await queueActions.press('ArrowDown')
  await expect(operatorPage.getByRole('menu')).toBeVisible()
  await expect(operatorPage.getByRole('menuitem', { name: /Bloquear/ })).toHaveCount(0)
  await operatorPage.keyboard.press('Escape')
  await expect(queueActions).toBeFocused()
  await operatorPage.goto(`${uiBase}admin/settings/files`)
  await expect(operatorPage).toHaveURL(`${uiBase}queue`)
  await operatorPage.goto(`${uiBase}admin/playlists`)
  await expect(operatorPage.getByRole('button', { name: 'Nueva lista', exact: true })).toHaveCount(0)
  await expect(operatorPage.getByRole('button', { name: 'Eliminar lista', exact: true })).toHaveCount(0)
  await operatorPage.goto(`${uiBase}admin/settings/animator?view=audio&panel=settings`)
  await expect(operatorPage.getByRole('heading', { name: 'Animador', exact: true })).toBeVisible()
  await expect(operatorPage.getByRole('button', { name: 'Ajustes', exact: true })).toHaveCount(0)
  await expect(operatorPage.getByRole('link', { name: 'Voz de saludos', exact: true })).toHaveCount(0)

  const managerPage = await pageFor(roles.manager.api, roles.manager.identity)
  await managerPage.goto(`${uiBase}admin/personalization`)
  await expect(managerPage.getByRole('heading', { name: 'Personalización', exact: true })).toBeVisible()
  await expect(managerPage.getByLabel('Enlace de soporte', { exact: false })).toHaveCount(0)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=cyan:s=240x80', '-frames:v', '1', path.join(directory, 'client-logo.png')])
  await managerPage.getByLabel('Seleccionar logo del cliente', { exact: true }).setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(directory, 'client-logo.png')) })
  await expect(managerPage.getByRole('status').filter({ hasText: 'Preparando logo' })).toHaveCount(0)
  await managerPage.getByLabel('Nombre del cliente', { exact: true }).fill('Client venue')
  await managerPage.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(managerPage.getByText('Cambios guardados.', { exact: true })).toBeVisible()
  assert.equal(stored('branding').supportUrl, 'https://example.com/support')
  await managerPage.getByLabel('Mostrar logo', { exact: true }).check()
  await managerPage.getByLabel('Posición', { exact: true }).selectOption('bottom-left')
  const opacity = managerPage.getByRole('slider', { name: 'Opacidad del logo' })
  await opacity.focus()
  await opacity.press('ArrowLeft')
  await expect(opacity).toBeFocused()
  await managerPage.getByRole('button', { name: 'Guardar logo en pantalla', exact: true }).click()
  await expect.poll(() => stored('playerDisplay').logo.enabled).toBe(true)
  assert.equal(stored('playerDisplay').announcement.backgroundColor, '#123456')
  assert.equal(stored('playerDisplay').logo.position, 'bottom-left')
  await managerPage.getByRole('combobox', { name: 'Fondo', exact: true }).selectOption(video.id)
  await managerPage.getByRole('button', { name: 'Guardar fondo', exact: true }).click()
  await expect(managerPage.getByText('Fondo guardado.', { exact: true })).toBeVisible()
  const background = JSON.parse(db.prepare('SELECT data FROM rooms WHERE roomId=1').get().data).prefs.transitionVideo
  assert.equal(background.videoId, video.id)
  assert.equal(background.dimOpacity, 0.55)
  for (const width of [390, 1440]) {
    await managerPage.setViewportSize({ width, height: 1000 })
    await managerPage.getByRole('main').evaluate((element) => {
      element.scrollTop = 0
    })
    assert.ok(await managerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await managerPage.screenshot({ path: path.join(directory, `manager-${width}.png`), fullPage: true })
    await managerPage.getByRole('main').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await managerPage.screenshot({ path: path.join(directory, `manager-controls-${width}.png`), fullPage: true })
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '30', '-c:v', 'libvpx', '-threads', '2', '-c:a', 'libopus', path.join(directory, 'playback.webm')])
  assert.equal((await operator.api.get(`${base}api/media/1?type=audio`)).status(), 200)
  db.prepare(`UPDATE queue SET status='REMOVED'`).run()
  queueId = Number(db.prepare(`INSERT INTO queue(roomId,userId,source,externalId,status,origin,title,artistOrChannel,requestIntent) VALUES(1,?,'YOUTUBE','fixture0001','APPROVED','OPERATOR','Karaoke fixture','Fixture','SING')`).run(operator.identity.userId).lastInsertRowid)
  await operatorPage.goto(`${uiBase}queue`)
  const player = await pageFor(operator.api, operator.identity)
  await installPlaybackFixture(player.context())
  await player.goto(`${uiBase}player`)
  await player.getByRole('button', { name: 'Reproducir', exact: true }).first().click()
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, { timeout: 20000 }).toBe('PLAYING')
  await expect.poll(() => player.locator('audio,video').evaluateAll(elements => elements.some(element => !element.paused && element.currentTime > 0))).toBe(true)
  await expect(player.getByTestId('display-logo-static')).toBeVisible({ timeout: 20000 })
  await expect(player.getByTestId('display-logo-static')).toHaveAttribute('alt', 'Logo de Client venue')
  await expect(player.getByTestId('display-logo-static')).toHaveCSS('opacity', '0.95')
  await player.getByRole('slider', { name: 'Volumen', exact: true }).press('ArrowLeft')
  await expect.poll(() => player.locator('video:not([data-media-role])').evaluate(element => element.volume)).toBeLessThan(1)
  await player.screenshot({ path: path.join(directory, 'operator-player.png') })
  await player.getByRole('button', { name: 'Pausar', exact: true }).first().click()
  await expect.poll(() => player.locator('audio,video').evaluateAll(elements => elements.every(element => element.paused))).toBe(true)
  await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  await expect(player.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await player.close()
  const managerPlayer = await pageFor(roles.manager.api, roles.manager.identity)
  await installPlaybackFixture(managerPlayer.context())
  await managerPlayer.goto(`${uiBase}player`)
  await managerPlayer.getByRole('button', { name: 'Reproducir', exact: true }).first().click()
  await expect.poll(() => managerPlayer.locator('audio,video').evaluateAll(elements => elements.some(element => !element.paused && element.currentTime > 0))).toBe(true)
  await managerPlayer.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  await expect(managerPlayer.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await managerPlayer.close()
  const participant = await pageFor(roles.standard.api, standardIdentity)
  await participant.goto(`${uiBase}player`)
  await expect(participant).toHaveURL(`${uiBase}library`)
  await expect(participant.getByRole('link', { name: 'Usuarios', exact: true })).toHaveCount(0)
  pass('role-filtered UI, limited logo persistence, keyboard/mobile layouts and actual operator audio playback')
  await operatorPage.goto(`${uiBase}admin/account`)
  await operatorPage.getByLabel('Nombre para mostrar', { exact: true }).fill('Operador de turno')
  await operatorPage.getByPlaceholder('contraseña actual', { exact: true }).fill('staff-access-test')
  await operatorPage.getByRole('button', { name: 'Actualizar cuenta', exact: true }).click()
  await expect.poll(() => db.prepare('SELECT name FROM users WHERE userId=?').get(operator.identity.userId).name).toBe('Operador de turno')
  await expect(operatorPage.getByRole('button', { name: 'Actualizar cuenta', exact: true })).toHaveCount(0)
  const beforeLogout = db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status
  await operatorPage.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await expect(operatorPage.getByRole('button', { name: 'Tengo una cuenta', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, beforeLogout)
  pass('staff can update their own account and sign out without removing room songs')

  const adminPage = await pageFor(admin, adminIdentity)
  await adminPage.goto(`${uiBase}admin/users`)
  await adminPage.getByRole('button', { name: 'Crear personal', exact: true }).click()
  const dialog = adminPage.getByRole('dialog', { name: 'Crear personal', exact: true })
  await expect(dialog.getByRole('combobox').locator('option[value="operator"]')).toHaveText('Operador')
  await expect(dialog.getByRole('combobox').locator('option[value="manager"]')).toHaveText('Encargado del local')
  await expect(dialog.getByRole('combobox').locator('option[value="player"]')).toHaveCount(0)
  assert.deepEqual(errors, [])
  pass('administrator retains user management and new role assignment')
  fs.writeFileSync(path.join(directory, 'checks.json'), JSON.stringify({ mode: development ? 'development' : 'production', httpsOrigin: https ? httpsOrigin : null, checks, errors }, null, 2))
  console.log(`Artifacts: ${directory}`)
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) {
    await page.screenshot({ path: path.join(directory, `failure-${index}.png`) }).catch(() => {})
    fs.writeFileSync(path.join(directory, `failure-${index}.txt`), await page.locator('body').ariaSnapshot().catch(() => ''))
  }
  console.error(`Artifacts: ${directory}`)
  throw error
} finally {
  for (const socket of sockets) socket.disconnect()
  await browser?.close()
  db?.close()
  await Promise.all(contexts.map(api => api.dispose()))
  if (server.exitCode === null && !server.signalCode) {
    const exited = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
  }
  fs.closeSync(log)
}
