import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-catalog-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
let server, browser, page, db, socket
const errors = []
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.ok(response.ok(), `${suffix}: ${response.status()} ${await response.text()}`)
  return response.json()
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited: ${data}/server.log`)
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
  const reply = await socket.timeout(4000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 3000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}

try {
  const source = path.join(data, 'fixture.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'catalog-test-password', newPasswordConfirm: 'catalog-test-password' })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Fixture\',\'fixture\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Fixture song\',\'fixture song\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'fixture.mp4\',3,1)')
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'catalog-test-password', roomId: 1 })
  const ids = []
  for (const title of ['Luces', 'Partículas', 'Escenario']) {
    const response = await api.post(`${base}api/animation/background/upload`, { multipart: {
      requestId: crypto.randomUUID(), title, file: { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(source) },
    } })
    assert.equal(response.status(), 202)
    const video = await response.json()
    ids.push(video.id)
    await expect.poll(async () => (await call(`animation/background/videos/${video.id}`)).state).toBe('ready')
    await expect.poll(async () => (await call('animation/background/')).capability.busy).toBe(false)
  }
  await call('animation/background/', { videoId: ids[0], dimOpacity: 0.55, revision: 0 }, 'PUT')
  await stop()
  await start()
  assert.equal((await call('animation/background/')).videos.length, 3)
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  if (httpsUi) {
    // Only frontend assets use the tunnel; all mutations/media/socket traffic use isolated data.
    await context.route('https://karaoke.puyu.pe/**', async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const socketTraffic = url.pathname.startsWith('/socket.io/')
      if (!socketTraffic && !url.pathname.startsWith('/api/')) return route.continue()
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      for (const key of ['content-type', 'range', 'if-range']) if (incoming.headers()[key]) headers[key] = incoming.headers()[key]
      try {
        const response = await api.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          const outgoing = response.headers()
          delete outgoing['content-length']
          await route.fulfill({ status: 200, headers: outgoing, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    })
    await context.routeWebSocket('**/socket.io/**', sock => sock.close())
  }
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/admin/settings/animator?view=background')}`)
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('catalog-test-password')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Fondo de transición', exact: true })
  const list = panel.getByRole('list', { name: 'Videos de transición' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  const row = title => list.getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) })
  await row('Partículas').getByRole('button', { name: 'Activar', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(row('Partículas').getByText('Activo', { exact: true })).toBeVisible()
  await panel.getByLabel('Modo de fondos').selectOption('all')
  await panel.getByRole('button', { name: 'Guardar fondo', exact: true }).click()
  await expect(panel.getByText('Fondo guardado.', { exact: true })).toBeVisible()
  await page.reload()
  await expect(panel.getByLabel('Modo de fondos')).toHaveValue('all')
  await row('Partículas').getByRole('button', { name: 'Vista previa', exact: true }).click()
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect.poll(() => panel.locator('video').evaluate(video => video.videoWidth > 0 && !video.paused)).toBe(true)
  assert.equal(db.prepare('SELECT SUM(selectionOrder) n FROM transitionVideos').get().n, 0, 'preview must not advance the rotation')
  await panel.getByRole('button', { name: 'Pausar vista previa', exact: true }).click()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await list.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(data, `catalog-${width}.png`), fullPage: true })
  }
  page.once('dialog', dialog => dialog.accept())
  await row('Escenario').getByRole('button', { name: 'Eliminar', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await panel.getByLabel('Modo de fondos').selectOption('single')
  await panel.getByLabel('Video para la vista previa').selectOption(ids[0])
  await panel.getByRole('button', { name: 'Guardar fondo', exact: true }).click()
  await expect(panel.getByText('Fondo guardado.', { exact: true })).toBeVisible()
  assert.equal((await call('animation/background/')).settings.videoId, ids[0])
  await panel.getByLabel('Modo de fondos').selectOption('all')
  await panel.getByRole('button', { name: 'Guardar fondo', exact: true }).click()
  await expect(panel.getByText('Fondo guardado.', { exact: true })).toBeVisible()

  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie } })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  const denied = await socket.timeout(3000).emitWithAck('action', { type: 'server/TRANSITION_VIDEO_SCENE', payload: { sceneId: 'operator', finished: false, expiresAt: Date.now() + 2000 } })
  assert.match(denied.error, /autoridad/)
  for (let i = 0; i < 3; i++) await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await page.addInitScript(() => {
    window.backgroundSequence = []
    document.addEventListener('loadedmetadata', (event) => {
      if (event.target instanceof HTMLVideoElement && event.target.dataset.mediaRole === 'transition-background') {
        window.backgroundSequence.push(event.target.src.match(/videos\/([^/]+)\/video/)[1])
      }
    }, true)
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${uiBase}player`)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(true)
  await page.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.backgroundSequence.length), { timeout: 30000 }).toBe(3)
  assert.deepEqual(await page.evaluate(() => window.backgroundSequence), [ids[0], ids[1], ids[0]])
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYED\'').get().n, { timeout: 15000 }).toBe(3)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, 0, 'visual rotation must work without animator audio')
  assert.deepEqual(errors, [])
  console.log(`PASS catalog retention/restart, keyboard activation, fixed/all modes, private preview, deletion, responsive UI and real visual-only playback rotation (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS frontend with isolated API/socket' : ''}). Artifacts: ${data}`)
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, 'failure.png'), fullPage: true })
  console.error({ artifacts: data, errors })
  throw error
} finally {
  socket?.close()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
