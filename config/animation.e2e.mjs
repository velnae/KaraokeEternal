import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:net'
import { io } from 'socket.io-client'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-animation-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const api = await request.newContext()
let server, browser, sock, db
const errors = []
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
  const entry = development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']
  server = spawn(process.execPath, [...entry, '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'],
    { cwd: root, env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false' }, stdio: ['ignore', log, log] })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for isolated server. */ }
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
const emit = async (type, payload = {}) => {
  const reply = await sock.timeout(3000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 2000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}
const latest = () => db.prepare('SELECT * FROM animationInterventions ORDER BY rowid DESC LIMIT 1').get()
const requestClip = () => emit('server/ANIMATION_REQUEST', { clipId: 'demo-welcome', requestId: crypto.randomUUID() })
const pass = name => console.log(`PASS ${name}`)

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call('setup', { username: 'admin', newPassword: 'animation-test-password', newPasswordConfirm: 'animation-test-password', name: 'Operator' })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Artist\',\'artist\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Local test\',\'local test\'),(2,1,\'Second test\',\'second test\'),(3,1,\'Third test\',\'third test\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',8,1),(2,2,1,\'song.mp4\',8,1),(3,3,1,\'song.mp4\',8,1)')
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'animation-test-password', roomId: 1 })
  const cookies = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  sock = io(origin, { path: '/karaoke/socket.io', extraHeaders: { cookie: cookies }, transports: ['websocket'], autoConnect: false })
  sock.connect()
  await new Promise((resolve, reject) => {
    sock.once('connect', resolve)
    sock.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--autoplay-policy=document-user-activation-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplay'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const installAudioProbes = () => {
    window.voiceStarts = []
    window.audioProbes = []
    window.duplicateAudioCloses = 0
    const closing = new WeakSet()
    const close = AudioContext.prototype.close
    AudioContext.prototype.close = function (...args) {
      if (closing.has(this) || this.state === 'closed') window.duplicateAudioCloses++
      closing.add(this)
      return close.apply(this, args)
    }
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args)
      if (this instanceof GainNode && destination === this.context.destination) {
        const analyser = this.context.createAnalyser()
        connect.call(this, analyser)
        window.audioProbes.push({ context: this.context, analyser })
      }
      return result
    }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.voiceContext = this.context
      const video = document.querySelector('video')
      window.voiceStarts.push({ at: Date.now(), overlapping: !!video && !video.paused && !video.ended })
      return start.apply(this, args)
    }
  }
  await context.addInitScript(installAudioProbes)
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const admin = await context.newPage()
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('animation-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${base}queue#animator`)
  await expect(admin).toHaveURL(`${base}admin/settings/animator`)
  await expect(admin.getByRole('heading', { name: 'Animador', exact: true, level: 1 })).toBeVisible()
  await expect(admin.getByLabel('Clip', { exact: true }).locator('option')).toHaveCount(3)
  let player = await context.newPage()
  // Exercise the cold mount before Socket.IO has assigned a socket ID.
  await player.route('**/socket.io/**', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.continue()
  })
  await player.goto(`${base}player`)
  await expect(player.getByRole('heading', { name: 'Sin canciones' })).toBeVisible()
  await player.unroute('**/socket.io/**')
  const outputPeak = () => player.evaluate(() => Math.max(0, ...window.audioProbes
    .filter(probe => probe.context.state === 'running')
    .map(({ analyser }) => {
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      return Math.max(...samples.map(Math.abs))
    })))
  let transport = player.getByRole('toolbar', { name: 'Controles de reproducción' })
  const enqueueFromLibrary = async (title, status = 'APPROVED') => {
    await admin.getByRole('link', { name: 'Biblioteca', exact: true }).click()
    await admin.getByRole('radio', { name: 'Archivos locales', exact: true }).check()
    await admin.getByRole('searchbox', { name: 'buscar canciones', exact: true }).fill(title)
    await admin.getByText(title, { exact: true }).last().click()
    await admin.getByRole('link', { name: 'Cola', exact: true }).click()
    await expect(admin.locator(`[data-status="${status}"]`).filter({ hasText: title })).toBeVisible()
  }
  await enqueueFromLibrary('Local test')
  await enqueueFromLibrary('Second test')
  await expect(admin.locator('[data-status="APPROVED"]')).toHaveCount(2)
  await transport.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  await transport.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(true)
  await expect.poll(outputPeak).toBeLessThan(0.001)
  await transport.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  const volume = transport.getByRole('slider', { name: 'Volumen', exact: true })
  await volume.focus()
  await volume.press('Home')
  await expect.poll(outputPeak).toBeLessThan(0.001)
  await volume.press('End')
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  pass('UI library enqueue, play/pause/resume and music volume produce the expected audio signal with animator off')

  await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  await expect(player.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await player.goBack()
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused).catch(() => false)).toBe(true)
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  await transport.getByRole('button', { name: 'Reproducir siguiente canción', exact: true }).click()
  await expect.poll(() => db.prepare('SELECT songId FROM queue WHERE status=\'PLAYING\'').get()?.songId).toBe(2)
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  await expect(player.getByRole('heading', { name: 'Sin canciones', exact: true })).toBeVisible({ timeout: 12000 })
  await enqueueFromLibrary('Third test', 'PLAYING')
  await expect.poll(() => db.prepare('SELECT songId FROM queue WHERE status=\'PLAYING\'').get()?.songId).toBe(3)
  await expect.poll(outputPeak).toBeGreaterThan(0.01)
  await player.evaluate(() => {
    window.videoBeforeNavigation = document.querySelector('video')
    window.timeBeforeNavigation = window.videoBeforeNavigation.currentTime
  })
  const navigation = admin.getByRole('navigation', { name: 'Secciones de administración' })
  for (const name of ['Animador', 'Usuarios', 'Cola']) await navigation.getByRole('link', { name, exact: true }).click()
  assert.ok(await player.evaluate(() => document.querySelector('video') === window.videoBeforeNavigation && !window.videoBeforeNavigation.paused && window.videoBeforeNavigation.currentTime >= window.timeBeforeNavigation))
  await expect(admin.locator('#animator')).toHaveCount(0)
  await expect(admin.getByRole('button', { name: 'Tomar micrófono' })).toHaveCount(0)
  pass('Admin navigation preserves the playing media element and time; queue contains no animator configuration')
  await transport.getByRole('button', { name: 'Reproducir siguiente canción', exact: true }).click()
  await expect(player.getByRole('heading', { name: 'Sin canciones', exact: true })).toBeVisible()
  assert.equal(await player.evaluate(() => window.duplicateAudioCloses), 0)
  assert.deepEqual(errors, [])
  pass('Leaving/reentering player, skipping, natural exhaustion and enqueueing again preserve playable audio without double close')

  // A fresh browser context has no origin engagement or player-tab activation.
  const blockedContext = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 1440, height: 1000 } })
  await blockedContext.addInitScript(installAudioProbes)
  blockedContext.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  await player.close()
  player = await blockedContext.newPage()
  await player.goto(`${base}player`)
  // Playwright locator assertions/evaluate grant user activation in Chromium.
  // Observe the restrictive case through CDP without synthesizing a gesture.
  const playerCDP = await blockedContext.newCDPSession(player)
  const inspect = async (cdp, expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, userGesture: false })).result.value
  transport = player.getByRole('toolbar', { name: 'Controles de reproducción' })
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(true)
  await emit('server/PLAYER_REQ_NEXT')
  await expect.poll(() => inspect(playerCDP, 'document.body.innerText.includes("No se pudo reproducir")')).toBe(true)
  await emit('server/PLAYER_REQ_NEXT')
  await expect.poll(() => inspect(playerCDP, 'document.body.innerText.includes("Sin canciones")')).toBe(true)

  await admin.getByRole('navigation', { name: 'Secciones de administración' }).getByRole('link', { name: 'Animador', exact: true }).click()
  const announce = admin.getByRole('button', { name: 'Anunciar en la próxima pausa' })
  await expect(announce).toBeDisabled()
  await expect(admin.getByText('Active el animador para solicitar un anuncio.', { exact: true })).toBeVisible()
  await admin.getByLabel('Activado', { exact: true }).focus()
  await admin.getByLabel('Activado', { exact: true }).press('Space')
  await expect(admin.getByLabel('Activado', { exact: true })).toBeChecked()
  await expect(announce).toBeEnabled()
  await expect(admin.getByText('Puede dejar el anuncio en espera. El sonido se habilita automáticamente o al usar Reproducir en el reproductor.', { exact: true })).toBeVisible()
  await announce.focus()
  await announce.press('Enter')
  await expect.poll(() => latest()?.status).toBe('PENDING')
  await expect.poll(() => inspect(playerCDP, 'document.body.innerText.includes("Permitir sonido")')).toBe(true)
  assert.equal(await inspect(playerCDP, 'navigator.userActivation.hasBeenActive'), false)
  assert.equal(await inspect(playerCDP, 'window.voiceStarts.length'), 0)
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1600 })
    await expect.poll(() => admin.locator('#animator').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBeGreaterThan(width <= 1100 ? width - 100 : width - 360)
    await admin.getByRole('heading', { name: 'Animador', exact: true, level: 1 }).scrollIntoViewIfNeeded()
    await admin.locator('#animator').screenshot({ path: path.join(data, `animation-awaiting-audio-${width}.png`) })
    await player.setViewportSize({ width, height: 1000 })
    await expect.poll(() => inspect(playerCDP, `(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'Permitir sonido');
      const rect = button?.getBoundingClientRect();
      return !!rect && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
    })()`)).toBe(true)
    const screenshot = await playerCDP.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(data, `player-audio-recovery-${width}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  await admin.getByRole('button', { name: 'Cancelar solicitud', exact: true }).focus()
  await admin.getByRole('button', { name: 'Cancelar solicitud', exact: true }).press('Enter')
  await expect.poll(() => latest()?.status).toBe('CANCELLED')
  await expect(announce).toBeEnabled()
  await announce.click()
  await expect.poll(() => latest()?.status).toBe('PENDING')
  pass('Enabled animator accepts and cancels requests by keyboard before unlocking audio, without public playback')
  // Ordinary keyboard interaction in the player unlocks audio; no special CTA.
  await transport.getByRole('slider', { name: 'Volumen', exact: true }).focus()
  await player.keyboard.press('End')
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await expect(player.getByTestId('announcement-overlay')).toBeVisible()
  await expect.poll(() => latest()?.status, { timeout: 10000 }).toBe('PLAYED')
  await expect(player.getByTestId('announcement-overlay')).toBeHidden()
  pass('Empty queue: real Web Audio clip, coordinated text, confirmed end')

  await player.evaluate(() => window.voiceContext.suspend())
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await expect(player.getByRole('button', { name: 'Permitir sonido' })).toHaveCount(0)
  assert.equal(await player.evaluate(() => window.voiceStarts.length), 1)
  pass('Suspended audio recovers automatically after prior activation without replaying a finished clip')

  await admin.getByRole('button', { name: 'Ajustes', exact: true }).click()
  const voiceVolume = admin.getByRole('slider', { name: 'Volumen de voz', exact: true })
  await voiceVolume.focus()
  await voiceVolume.press('Home')
  await admin.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click()
  await expect(announce).toBeDisabled()
  await expect(admin.getByText('Suba el volumen de voz para solicitar un anuncio.', { exact: true })).toBeVisible()
  await admin.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await expect(voiceVolume).toBeEnabled()
  await voiceVolume.focus()
  await voiceVolume.press('End')
  await admin.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click()
  await expect(announce).toBeEnabled()
  await expect(admin.getByRole('button', { name: /micrófono/i })).toHaveCount(0)
  pass('Volume blockers recover through settings; obsolete microphone controls are absent')

  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 1000 })
    await expect.poll(() => admin.locator('#animator').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBeGreaterThan(width <= 1100 ? width - 100 : width - 360)
    await admin.getByRole('heading', { name: 'Animador', exact: true, level: 1 }).scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`)
    assert.ok(await admin.getByLabel('Clip', { exact: true }).evaluate(element => element.getBoundingClientRect().width > 200), `clip selector squeezed at ${width}`)
    await admin.screenshot({ path: path.join(data, `animation-${width}.png`) })
  }
  pass('Operator panel responsive at 320, 390, 768 and 1440 px')

  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused).catch(() => false)).toBe(true)
  await emit('server/PLAYER_REQ_PAUSE')
  await requestClip()
  await player.waitForTimeout(1200)
  assert.equal(latest().status, 'PENDING')
  await expect(player.getByTestId('announcement-overlay')).toBeHidden()
  // Resume is an explicit musical command and cancels the pending manual request.
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => latest()?.status).toBe('CANCELLED')
  await requestClip()
  await expect(player.getByTestId('announcement-overlay')).toBeVisible({ timeout: 12000 })
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYING\'').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE status=\'APPROVED\'').get().n, 1)
  await expect.poll(() => latest()?.status, { timeout: 10000 }).toBe('PLAYED')
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYING\'').get().n).toBe(1)
  assert.ok((await player.evaluate(() => window.voiceStarts)).every(start => !start.overlapping))
  pass('Paused music blocks voice; natural end -> voice -> next song, no premature PLAYING or overlap')

  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await requestClip()
  await expect(player.getByTestId('announcement-overlay')).toBeVisible({ timeout: 12000 })
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(() => latest()?.status).toBe('INTERRUPTED')
  await player.waitForTimeout(500)
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE status=\'APPROVED\'').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE status=\'PLAYING\'').get().n, 0)
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused).catch(() => false)).toBe(true)
  pass('Pause during voice keeps the next song waiting until the operator resumes')

  await emit('server/PLAYER_REQ_NEXT')
  await expect.poll(() => player.locator('video').count()).toBe(0)
  const standbyContext = await browser.newContext({ storageState: await context.storageState() })
  await standbyContext.addInitScript(installAudioProbes)
  standbyContext.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const standby = await standbyContext.newPage()
  await standby.goto(`${base}player`)
  const standbyCDP = await standbyContext.newCDPSession(standby)
  await expect.poll(() => inspect(standbyCDP, 'document.body.innerText.includes("Ya hay un reproductor activo")')).toBe(true)
  await requestClip()
  await expect(player.getByTestId('announcement-overlay')).toBeVisible()
  await admin.getByRole('button', { name: 'Detener anuncio', exact: true }).click()
  await expect.poll(() => latest()?.status).toBe('INTERRUPTED')
  await expect(player.getByTestId('announcement-overlay')).toBeHidden()
  assert.equal(await inspect(standbyCDP, 'window.voiceStarts.length'), 0)
  pass('Explicit stop interrupts voice and standby player never emits')

  let controls = (await emit('server/ANIMATION_SYNC')).payload
  await requestClip()
  await expect(player.getByTestId('announcement-overlay')).toBeVisible()
  controls = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: controls.controlVersion, enabled: false })
  await expect.poll(() => latest()?.status).toBe('INTERRUPTED')
  await expect(player.getByTestId('announcement-overlay')).toBeHidden()
  pass('Disabling cancels active audio with a confirmed stop')

  controls = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: controls.controlVersion, enabled: true })
  await emit('server/PLAYER_REQ_REPLAY', { queueId: 1 })
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused).catch(() => false)).toBe(true)
  await requestClip()
  await emit('server/PLAYER_REQ_REPLAY', { queueId: 1 })
  await expect.poll(() => latest()?.status).toBe('CANCELLED')
  await expect.poll(() => player.locator('video').evaluate(video => video.currentTime)).toBeLessThan(1)
  await emit('server/PLAYER_REQ_NEXT')
  await expect.poll(() => player.locator('video').count()).toBe(0)
  pass('Replay overrides a pending announcement without losing musical control')

  await requestClip()
  await expect(player.getByTestId('announcement-overlay')).toBeVisible()
  const interruptedId = latest().interventionId
  const leaseUntil = latest().leaseUntil
  await player.close()
  await expect.poll(() => inspect(standbyCDP, 'document.body.innerText.includes("Permitir sonido")')).toBe(true)
  await expect.poll(() => latest()?.status).toBe('UNCERTAIN')
  const rejected = await sock.timeout(3000).emitWithAck('action', { type: 'server/ANIMATION_REQUEST', payload: { clipId: 'demo-welcome', requestId: crypto.randomUUID(), expiresAt: Date.now() + 2000 } })
  assert.ok(rejected.error?.includes('recuperación'), rejected.error)
  await standby.waitForTimeout(Math.max(0, leaseUntil - Date.now()) + 200)
  assert.equal(latest().interventionId, interruptedId)
  assert.equal(await inspect(standbyCDP, 'window.voiceStarts.length'), 0)
  await standby.getByRole('button', { name: 'Permitir sonido' }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  pass('Disconnect fences takeover; uncertain audio is never replayed')

  await requestClip()
  await expect(standby.getByTestId('announcement-overlay')).toBeVisible()
  const beforeRestart = latest().interventionId
  await stop()
  await expect(standby.getByTestId('announcement-overlay')).toBeHidden()
  await start()
  await expect.poll(() => sock.connected, { timeout: 10000 }).toBe(true)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent, { timeout: 10000 }).toBe(true)
  assert.equal(latest().interventionId, beforeRestart)
  assert.equal(latest().status, 'UNCERTAIN')
  assert.equal(await standby.evaluate(() => window.voiceStarts.length), 1)
  pass('Server restart stops voice, restores authority and retains uncertain delivery')

  await standby.waitForTimeout(Math.max(0, latest().leaseUntil - Date.now()) + 200)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await requestClip()
  // Recovered music may still be playing the eight-second fixture after restart.
  await expect(standby.getByTestId('announcement-overlay')).toBeVisible({ timeout: 15000 })
  const startsBeforeExit = await standby.evaluate(() => window.voiceStarts.length)
  await standby.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  await expect(standby.getByRole('link', { name: 'Abrir reproductor', exact: true })).toBeVisible()
  await standby.goBack()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await expect(standby.getByTestId('announcement-overlay')).toBeHidden()
  assert.equal(await standby.evaluate(() => window.voiceStarts.length), startsBeforeExit)
  assert.equal(await standby.evaluate(() => window.duplicateAudioCloses), 0)
  pass('SPA exit during voice releases audio; returning does not replay the interrupted clip or close a context twice')

  assert.deepEqual(errors, [])
  console.log(`Evidence: ${data}`)
} catch (error) {
  console.error(`Evidence retained: ${data}`)
  console.error('Page errors:', errors)
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('Page:', page.url(), await page.locator('body').innerText().catch(() => 'unavailable'))
  }
  throw error
} finally {
  sock?.disconnect()
  await browser?.close()
  db?.close()
  await api.dispose()
  await stop()
  fs.closeSync(log)
}
