import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { checkRemoteFullscreen } from './remote-fullscreen-checks.e2e.mjs'

// Use an installed modern Chromium engine. Chrome 128+ is the supported target;
// changing the user agent does not test a different JS/CSS/media engine.
const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'player-compatibility-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
let server, browser, page, db
const errors = []
const call = async (suffix, body) => {
  const response = await api.post(`${base}api/${suffix}`, { data: body })
  assert.equal(response.status(), 200, await response.text())
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '', KES_GEMINI_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. Logs: ${data}`)
    try {
      return (await api.get(`${base}api/prefs`)).status()
    } catch {
      return 0
    }
  }, { timeout: 120000 }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exit = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exit
}

try {
  // Open codecs work in unbranded Chromium snapshots too. The API fixture below
  // uses real browser media playback, but does not emulate YouTube's network/CDN.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '30', '-c:v', 'libvpx', '-threads', '2', '-c:a', 'libopus', path.join(data, 'video.webm')])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '5', path.join(data, 'local.mp3')])
  fs.writeFileSync(path.join(data, 'local.cdg'), Buffer.alloc(5 * 300 * 24))
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'compatibility-test', newPasswordConfirm: 'compatibility-test' })
  await stop()
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec(`INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,'Local audio','local audio');`)
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec(`INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,'local.mp3',5,1)`)
  db.exec(`INSERT INTO queue(queueId,roomId,userId,prevQueueId,source,songId,externalId,title,artistOrChannel,origin) VALUES
    (1,1,1,NULL,'YOUTUBE',NULL,'fixture0001','First video','Fixture','OPERATOR'),
    (2,1,1,1,'LOCAL',1,NULL,'Local audio','Fixture','OPERATOR'),
    (3,1,1,2,'YOUTUBE',NULL,'fixture0002','Second video','Fixture','OPERATOR')`)
  await start()
  await call('login', { username: 'admin', password: 'compatibility-test', roomId: 1 })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (httpsUi) {
    // Real HTTPS assets, isolated API and polling: never join the shared room.
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      for (const name of ['content-type', 'range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
      try {
        const response = await api.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch (error) {
        if (page && !page.isClosed()) errors.push(`${url.pathname}: ${error.message.split('\n')[0]}`)
        await route.abort().catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  await context.route('**/compatibility-video.webm', route => route.fulfill({ path: path.join(data, 'video.webm'), contentType: 'video/webm' }))
  await context.addInitScript(() => {
    window.compatibility = { contexts: [], failAudio: true, blockOnce: true, video: null, clockTicks: 0, playerVars: null, fullscreenRequests: [], closeCalls: 0 }
    const closeWindow = window.close
    window.close = function () {
      window.compatibility.closeCalls++
      closeWindow.call(window)
    }
    const requestFullscreen = Element.prototype.requestFullscreen
    Element.prototype.requestFullscreen = function (...args) {
      window.compatibility.fullscreenRequests.push({ id: this.id, active: navigator.userActivation.isActive })
      return requestFullscreen.apply(this, args)
    }
    const setInterval = window.setInterval
    window.setInterval = (handler, delay, ...args) => setInterval(typeof handler === 'function' && delay === 250
      ? (...values) => {
          window.compatibility.clockTicks++
          return handler(...values)
        }
      : handler, delay, ...args)
    const NativeAudioContext = window.AudioContext
    window.AudioContext = class extends NativeAudioContext {
      constructor (...args) {
        if (window.compatibility.failAudio) throw new Error('Local audio device unavailable')
        super(...args)
        window.compatibility.contexts.push(this)
      }
    }
    window.YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
      Player: class {
        constructor (target, options) {
          this.options = options
          window.compatibility.playerVars = options.playerVars
          this.video = document.createElement('video')
          this.video.style.cssText = 'width:100%;height:100%'
          this.video.setAttribute('data-testid', 'youtube-media-fixture')
          target.replaceChildren(this.video)
          window.compatibility.video = this.video
          for (const [event, state] of [['playing', 1], ['pause', 2], ['ended', 0]]) {
            this.video.addEventListener(event, () => {
              // YouTube reports ENDED directly, not a separate PAUSED first.
              if (state !== 2 || !this.video.ended) options.events.onStateChange({ target: this, data: state })
            })
          }
          queueMicrotask(() => options.events.onReady({ target: this }))
        }

        loadVideoById () {
          this.video.src = `${document.baseURI}compatibility-video.webm`
          this.playVideo()
        }

        cueVideoById (id) {
          this.videoId = id
          this.video.src = `${document.baseURI}compatibility-video.webm`
          queueMicrotask(() => this.options.events.onStateChange({ target: this, data: 5 }))
        }

        playVideo () {
          if (window.compatibility.blockOnce) {
            window.compatibility.blockOnce = false
            queueMicrotask(() => this.options.events.onAutoplayBlocked({ target: this }))
          } else void this.video.play().catch(() => this.options.events.onAutoplayBlocked({ target: this }))
        }

        pauseVideo () { this.video.pause() }
        getCurrentTime () { return this.video.currentTime }
        getVideoUrl () { return `https://www.youtube.com/watch?v=${this.videoId}` }
        seekTo (seconds) { this.video.currentTime = seconds }
        setVolume (volume) { this.video.volume = volume / 100 }
        setSize () {}
        destroy () {
          this.video.pause()
          this.video.removeAttribute('src')
          this.video.load()
        }
      },
    }
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/player')}`)
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('compatibility-test')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  await toolbar.getByRole('button', { name: 'Opciones de pantalla' }).click()
  const dialog = page.getByRole('dialog', { name: 'Pantalla', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('display', 'flex')
  await page.keyboard.press('Control+Alt+k')
  assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'fullscreen shortcut must not interrupt a dialog')
  const visualizer = dialog.getByRole('checkbox', { name: 'Visualizador', exact: true })
  if (await visualizer.isChecked()) await visualizer.click()
  await expect(visualizer).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('player-fs-container')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=1').get().status, 'APPROVED', 'fullscreen does not replace the initial local Play')
  await page.evaluate(() => document.exitFullscreen())
  await toolbar.getByRole('button', { name: 'Reproducir', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Reproducir aquí', exact: true })
  await expect(retry).toBeVisible()
  assert.equal(await page.evaluate(() => window.compatibility.playerVars.controls), 0)
  await page.screenshot({ path: path.join(data, 'blocked-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(retry).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: path.join(data, 'blocked-mobile.png') })
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect(retry).not.toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(toolbar.getByRole('button', { name: 'Activar pantalla completa', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+K')
  const clockTicks = await page.evaluate(() => window.compatibility.clockTicks)
  await page.keyboard.press('Control+Alt+k')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('player-fs-container')
  assert.equal(await page.evaluate(() => document.fullscreenElement.tagName), 'DIV', 'fullscreen belongs to karaoke, not YouTube')
  await expect.poll(() => page.evaluate(() => window.compatibility.video.currentTime), { timeout: 35000 }).toBeGreaterThan(22)
  assert.equal(await page.evaluate(() => window.compatibility.clockTicks), clockTicks, 'ordinary music playback does not run the 250 ms animation clock')
  assert.equal(await page.evaluate(() => window.compatibility.contexts.length), 0)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=1').get().status, 'PLAYING')
  await page.evaluate(() => document.exitFullscreen())
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await page.evaluate(() => {
    window.compatibility.failAudio = false
  })
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, { timeout: 15000 }).toBe('PLAYING')
  await expect.poll(() => page.evaluate(() => window.compatibility.contexts.some(context => context.state === 'running'))).toBe(true)
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=3').get().status, { timeout: 15000 }).toBe('PLAYING')
  await expect.poll(() => page.evaluate(() => window.compatibility.contexts.every(context => context.state === 'closed'))).toBe(true)
  await page.screenshot({ path: path.join(data, 'playing-desktop.png') })
  await toolbar.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.compatibility.video.paused)).toBe(true)
  await toolbar.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.compatibility.video.paused)).toBe(false)
  await checkRemoteFullscreen({ player: page, uiBase, data, db })
  await page.goto(`${uiBase}queue`)
  await expect(page.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pantalla completa del reproductor', exact: true })).toBeDisabled()
  await expect(page.getByText('Sin reproductor', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver pasos para fullscreen remoto' })).toHaveCount(0)
  await expect(page.getByText('Abre el reproductor para continuar.', { exact: true })).toHaveCSS('clip-path', 'inset(50%)')
  await page.goto(`${uiBase}admin/settings/animator?view=greeting-voice`)
  await expect(page.getByRole('heading', { name: 'Voz de saludos', exact: true })).toBeVisible()
  await expect(page.getByText('Falta la clave de Gemini', { exact: true })).toBeVisible()
  await page.getByLabel('Voz de Gemini', { exact: true }).fill('Kore')
  await page.keyboard.press('Control+Alt+k')
  assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'player shortcut does not act in admin forms')
  await page.getByRole('button', { name: 'Guardar ajustes', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Configuración guardada.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generar prueba de voz', exact: true })).toBeDisabled()
  assert.equal(db.prepare('SELECT count(*) n FROM greetingVoiceRequests').get().n, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: path.join(data, 'greeting-voice-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(`PASS ${await browser.version()}: karaoke fullscreen shortcut, controls=0 with keyboard autoplay recovery, no 250ms ticking during >22s native playback, local audio handoff/cleanup and unchanged admin settings (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS frontend / isolated API' : ''}). Artifacts: ${data}`)
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, 'failure.png') }).catch(() => {})
  let media = null
  if (page && !page.isClosed()) {
    media = await page.evaluate(() => {
      const video = window.compatibility?.video
      return video && { time: video.currentTime, duration: video.duration, paused: video.paused, ended: video.ended }
    }).catch(() => null)
  }
  console.error({ errors, media, artifacts: data })
  throw error
} finally {
  await browser?.close()
  await api.dispose()
  await stop()
  db?.close()
  fs.closeSync(log)
}
