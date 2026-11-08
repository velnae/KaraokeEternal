import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const realYouTube = process.env.KARAOKE_E2E_REAL_YOUTUBE === '1'
const data = fs.mkdtempSync('/tmp/opencode/player-branding-')
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
let server, browser, player, editor, socket, db
const errors = []
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(6000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 5000 } })
  assert.ok(!response.error, response.error)
  return response
}
const playing = async (id) => {
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(id)?.status, { timeout: 30000 }).toBe('PLAYING')
  await expect(player.getByTestId('transition-scene')).toHaveCount(0, { timeout: 30000 })
  await expect(player.getByTestId('player-branding')).toBeVisible({ timeout: 30000 })
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=6', '-t', '180',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', path.join(data, 'song.mp4')])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10', '-t', '1',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', path.join(data, 'background.mp4')])
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. Logs: ${data}`)
    try {
      return (await api.get(`${base}api/prefs`)).status()
    } catch {
      return 0
    }
  }, { timeout: 120000 }).toBe(200)
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'branding-test-password', newPasswordConfirm: 'branding-test-password' })
  await call('login', { username: 'admin', password: 'branding-test-password', roomId: 1 })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  for (const [index, intent] of ['LISTEN', 'SING', 'UNKNOWN'].entries()) {
    db.prepare(`INSERT INTO queue(queueId,roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin,requestIntent)
      VALUES(?,1,1,?,'YOUTUBE','aqz-KE-bpKQ',?,'Fixture','OPERATOR',?)`).run(index + 1, index || null, `${intent} fixture`, intent)
  }
  const uploaded = await api.post(`${base}api/animation/background/upload`, { multipart: {
    requestId: 'branding-background', file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'background.mp4')) },
  } })
  assert.equal(uploaded.status(), 202)
  const background = await uploaded.json()
  await expect.poll(async () => (await call(`animation/background/videos/${background.id}`)).state).toBe('ready')
  await call('animation/background/', { videoId: background.id, dimOpacity: 0.55, revision: 0 }, 'PUT')
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: await api.storageState() })
  if (httpsUi) {
    // Serve the real HTTPS frontend, but keep all mutable data and player authority isolated.
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
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  if (!realYouTube) {
    await installYouTubeTransitionFixture(context, path.join(data, 'song.mp4'))
    await context.addInitScript(() => {
      const Original = window.YT.Player
      window.YT.Player = class extends Original {
        constructor (...args) {
          super(...args)
          window.brandingMock = this
        }
      }
    })
  }
  await context.addInitScript(() => {
    window.brandingTransitionOverlap = false
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="transition-scene"]') && document.querySelector('[data-testid="player-branding"]')) window.brandingTransitionOverlap = true
      }).observe(document.body, { childList: true, subtree: true })
    })
  })
  editor = await context.newPage()
  editor.on('pageerror', error => errors.push(error.message))
  const logoSrc = await editor.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 360
    canvas.height = 144
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#76e0ec'
    ctx.fillRect(0, 0, 360, 144)
    ctx.fillStyle = '#030509'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('IL GATTO', 180, 90)
    return canvas.toDataURL('image/png')
  })
  const defaults = (await call('prefs')).branding
  await call('prefs/branding', { ...defaults, name: 'Il Gatto', logoSrc }, 'PUT')
  await editor.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/admin/settings/branding')}`)
  await editor.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await editor.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await editor.getByPlaceholder('contraseña', { exact: true }).fill('branding-test-password')
  await editor.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const fields = editor.getByRole('region', { name: 'Durante las canciones' })
  await expect(fields).toBeVisible()
  player = await context.newPage()
  player.on('pageerror', error => errors.push(error.message))
  await player.goto(`${uiBase}player`)
  await player.getByRole('button', { name: 'Reproducir', exact: true }).last().click()
  await expect(player.getByTestId('transition-scene')).toBeVisible()
  await expect(player.getByTestId('player-branding')).toHaveCount(0)
  await playing(1)
  const activeMedia = player.locator(realYouTube ? 'iframe' : 'video:not([data-media-role="transition-background"])')
  const originalBounds = await activeMedia.boundingBox()
  await activeMedia.evaluate((element) => {
    window.brandingMedia = element
  })
  const banner = player.getByRole('region', { name: 'Comunicados del local' })
  const playerLogo = player.getByRole('img', { name: 'Logo de Il Gatto' })
  await expect(banner).toHaveCount(0)
  await expect(playerLogo).toHaveCount(0)
  for (const label of ['Mostrar logo en el reproductor', 'Mostrar comunicados durante música para escuchar']) {
    const checkbox = fields.getByRole('checkbox', { name: label, exact: true })
    await checkbox.focus()
    await checkbox.press('Space')
    await expect(checkbox).toBeChecked()
  }
  const alignment = fields.getByLabel('Alineación del contenido')
  const backgroundColor = fields.getByLabel('Color de fondo del comunicado', { exact: true })
  await expect(alignment).toHaveValue('left')
  await alignment.focus()
  await alignment.press('End')
  await alignment.press('Enter')
  await expect(alignment).toHaveValue('center')
  await backgroundColor.fill('#oops')
  await editor.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(backgroundColor).toBeFocused()
  await expect(backgroundColor).toHaveAttribute('aria-invalid', 'true')
  await fields.getByRole('button', { name: 'Usar marrón suave' }).focus()
  await editor.keyboard.press('Enter')
  await expect(backgroundColor).toHaveValue('#6b5143')
  await fields.getByRole('button', { name: 'Agregar comunicado' }).click()
  await editor.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(fields.getByLabel('Título del comunicado 2')).toBeFocused()
  await fields.getByLabel('Título del comunicado 2').fill('Disfruta la noche con nosotros')
  await fields.getByLabel('Texto del comunicado 2 (opcional)').fill('Tu próxima canción empieza en tu mesa.')
  await expect(playerLogo).toHaveCount(0)
  const preview = fields.getByRole('combobox', { name: 'Contenido de la vista previa' })
  await preview.focus()
  await preview.press('ArrowDown')
  await preview.press('Enter')
  await expect(fields.getByRole('region', { name: 'Comunicados del local' })).toHaveCount(0)
  await expect(fields.getByRole('img', { name: 'Logo de Il Gatto' })).toBeVisible()
  await preview.selectOption('TRANSITION')
  await expect(fields.getByTestId('player-branding')).toHaveCount(0)
  await preview.selectOption('LISTEN')
  await editor.getByRole('button', { name: 'Guardar cambios' }).focus()
  await editor.keyboard.press('Enter')
  await expect(editor.getByText('Cambios guardados.', { exact: true })).toBeVisible()
  await expect(playerLogo).toBeVisible()
  await expect(banner).toBeVisible()
  await expect(banner).toHaveCSS('background-color', /^rgba\(107, 81, 67, 0\.(878\d*|88)\)$/)
  await expect(banner.locator('strong:visible')).toHaveCSS('text-align', 'center')
  const bounds = await banner.boundingBox()
  const iconBounds = await banner.locator('svg').boundingBox()
  const textBounds = await banner.locator('strong:visible').boundingBox()
  assert.ok(Math.abs((iconBounds.x + textBounds.x + textBounds.width) / 2 - (bounds.x + bounds.width / 2)) < 1, 'icon and copy are centered together')
  assert.deepEqual(await activeMedia.boundingBox(), originalBounds, 'branding does not change video dimensions or placement')
  assert.equal(await activeMedia.evaluate(element => element === window.brandingMedia), true, 'saving preferences preserves the media element')
  if (!realYouTube) assert.ok(await activeMedia.evaluate(element => !element.paused && element.currentTime > 0))
  await editor.reload()
  await expect(fields.getByRole('checkbox', { name: 'Mostrar logo en el reproductor', exact: true })).toBeChecked()
  await expect(fields.getByLabel('Título del comunicado 2')).toHaveValue('Disfruta la noche con nosotros')
  await expect(alignment).toHaveValue('center')
  await expect(backgroundColor).toHaveValue('#6b5143')
  const saved = (await call('prefs')).branding
  await alignment.selectOption('left')
  await backgroundColor.fill('#eeeeee')
  await fields.getByLabel('Título del comunicado 1').fill('Cambio sin guardar')
  await editor.getByRole('button', { name: 'Descartar' }).click()
  await expect(fields.getByLabel('Título del comunicado 1')).toHaveValue(saved.player.messages[0].title)
  await expect(alignment).toHaveValue('center')
  await expect(backgroundColor).toHaveValue('#6b5143')
  for (const width of [1920, 390]) {
    await editor.setViewportSize({ width, height: 1080 })
    await fields.screenshot({ path: path.join(data, `editor-${width}.png`) })
    await fields.locator('figure').screenshot({ path: path.join(data, `preview-${width}.png`) })
    const previewBounds = await fields.locator('figure').boundingBox()
    const previewLayer = await fields.getByTestId('player-branding').boundingBox()
    assert.ok(previewLayer.x >= previewBounds.x && previewLayer.x + previewLayer.width <= previewBounds.x + previewBounds.width, 'preview fits inside its mobile frame')
    await player.setViewportSize({ width, height: 1080 })
    await expect.poll(() => player.locator('#player-fs-container').evaluate(element => element.clientWidth)).toBe(width)
    await player.screenshot({ path: path.join(data, `player-${width}.png`) })
    for (const page of [player, editor]) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const panel = await banner.boundingBox()
    assert.ok(panel.x >= 0 && panel.x + panel.width <= width)
  }
  await player.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(() => player.locator('#player-fs-container').evaluate(element => element.clientWidth)).toBe(1920)
  if (!realYouTube) {
    await activeMedia.evaluate((element) => {
      element.style.filter = 'brightness(.2)'
    })
    await player.screenshot({ path: path.join(data, 'player-dark.png') })
    await activeMedia.evaluate((element) => {
      element.style.filter = ''
    })
  }
  await player.keyboard.press('Control+Alt+k')
  await expect.poll(() => player.evaluate(() => document.fullscreenElement?.id)).toBe('player-fs-container')
  await expect(banner).toBeVisible()
  await player.screenshot({ path: path.join(data, 'player-fullscreen.png') })
  await player.evaluate(() => document.exitFullscreen())
  await expect.poll(() => player.evaluate(() => !!document.fullscreenElement)).toBe(false)
  await expect.poll(() => activeMedia.boundingBox()).toEqual(originalBounds)
  const centeredBounds = await banner.boundingBox()
  await call('prefs/branding', { ...saved, player: { ...saved.player, alignment: 'left', backgroundColor: '#eeeeee' } }, 'PUT')
  await expect(banner.locator('strong:visible')).toHaveCSS('text-align', 'left')
  await expect(banner).toHaveCSS('color', 'rgb(3, 5, 9)')
  const leftBounds = await banner.boundingBox()
  assert.equal(leftBounds.width, centeredBounds.width)
  assert.equal(leftBounds.height, centeredBounds.height)
  await call('prefs/branding', { ...saved, player: { ...saved.player, showLogo: false } }, 'PUT')
  await expect(playerLogo).toHaveCount(0)
  await expect(banner).toBeVisible()
  await call('prefs/branding', { ...saved, player: { ...saved.player, showAnnouncements: false } }, 'PUT')
  await expect(playerLogo).toBeVisible()
  await expect(banner).toHaveCount(0)
  await call('prefs/branding', saved, 'PUT')
  await expect(banner).toBeVisible()
  const currentTitle = banner.locator('strong:visible')
  const firstTitle = await currentTitle.textContent()
  await expect(currentTitle).not.toHaveText(firstTitle, { timeout: 18000 })
  await emit('server/PLAYER_REQ_PAUSE')
  const pausedTitle = await currentTitle.textContent()
  await player.waitForTimeout(15500)
  await expect(currentTitle).toHaveText(pausedTitle)
  await emit('server/PLAYER_REQ_PLAY')
  for (const id of [2, 3]) {
    await emit('server/PLAYER_REQ_NEXT')
    await expect(player.getByTestId('transition-scene')).toBeVisible()
    await expect(player.getByTestId('player-branding')).toHaveCount(0)
    await playing(id)
    await expect(playerLogo).toBeVisible()
    await expect(banner).toHaveCount(0)
  }
  if (!realYouTube) {
    await player.evaluate(() => window.brandingMock.options.events.onError({ target: window.brandingMock, data: 150 }))
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=3').get().status).toBe('FAILED')
    await expect(player.getByTestId('player-branding')).toHaveCount(0)
  }
  assert.equal(await player.evaluate(() => window.brandingTransitionOverlap), false)
  assert.deepEqual(errors, [])
  console.log(`PASS branding persistence, keyboard, preview, responsive/fullscreen, independent switches, rotation/pause, LISTEN/SING/UNKNOWN, transitions, unchanged media (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS frontend + isolated API/socket' : ''}${realYouTube ? ', real YouTube' : ', media fixture'}). Artifacts: ${data}`)
} catch (error) {
  for (const [name, page] of [['player', player], ['editor', editor]]) if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, `${name}-failure.png`) }).catch(() => {})
  console.error({ artifacts: data, errors })
  throw error
} finally {
  socket?.close()
  await browser?.close()
  if (server?.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
