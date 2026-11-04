import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubeTransitionFixture, checkAmbienceHandoff } from './transition-ambience-checks.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-player-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
let server, browser, player, socket, db
const errors = []
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const start = async () => {
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
  }, { timeout: 120000, intervals: [250, 500] }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const done = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await done
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(4000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 3000 } })
  assert.ok(!response.error, response.error)
  return response
}
const uploadAudio = async (id, kind, family, seconds, frequency) => {
  const file = path.join(data, `${id}.wav`)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', String(seconds), file])
  const response = await api.post(`${base}api/animation/resources/upload`, { multipart: { requestId: id, title: id, kind,
    metadata: JSON.stringify({ text: family === 'closing' ? 'Gracias por cantar. Seguimos con la próxima canción.' : 'La próxima canción ya está lista.',
      family, modes: ['mixed'], category: kind === 'effect' ? 'transition' : '', effectType: kind === 'effect' ? 'transition' : undefined,
      loop: kind === 'ambience' ? true : undefined }),
    file: { name: `${id}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(file) } } })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const active = () => db.prepare('SELECT * FROM animationInterventions WHERE status IN (\'RESERVED\',\'PLAYING\') ORDER BY rowid DESC LIMIT 1').get()
const songStatus = id => db.prepare('SELECT status FROM queue WHERE queueId=?').get(id)?.status

try {
  for (const [name, duration, source] of [['song', 3, 'color=c=blue:s=320x180:r=10'], ['background', 1, 'testsrc2=size=320x180:rate=10']]) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source, '-f', 'lavfi', '-i', 'sine=frequency=220',
      '-t', String(duration), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, `${name}.mp4`)])
  }
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'transition-player-test', newPasswordConfirm: 'transition-player-test' })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Fixture\',\'fixture\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Fixture song\',\'fixture song\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',3,1)')
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'transition-player-test', roomId: 1 })
  const voice = await uploadAudio('turn', 'voice', 'turn', 2, 330)
  const volumeVoice = await uploadAudio('volume-check', 'voice', 'manual', 8, 550)
  await uploadAudio('closing', 'voice', 'closing', 1.8, 440)
  const effect = await uploadAudio('separator', 'effect', 'manual', 0.8, 660)
  const bed = await uploadAudio('pause-bed', 'ambience', 'manual', 7, 110)
  const alternateBed = await uploadAudio('alternate-bed', 'ambience', 'manual', 7, 140)
  const uploaded = await api.post(`${base}api/animation/background/upload`, { multipart: {
    requestId: 'background', file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'background.mp4')) },
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
  let snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true,
    ambienceEnabled: true, profile: 'mixed', volume: 0.5, ambienceVolume: 0.2,
    events: { welcome: false, turn: true, closing: true, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
  await emit('server/ANIMATION_SESSION', { operation: 'open' })
  for (let index = 0; index < 2; index++) await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  const catalog = await call('animation/catalog')
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: await api.storageState() })
  if (httpsUi) {
    // Use the real HTTPS frontend without taking over the shared room's player.
    // Both API calls and Socket.IO polling belong to this isolated fixture server.
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
          if (!open.startsWith('0')) throw new Error('Missing Engine.IO handshake')
          const handshake = JSON.parse(open.slice(1))
          handshake.upgrades = []
          const responseHeaders = response.headers()
          delete responseHeaders['content-length']
          await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch (error) {
        if (player && !player.isClosed() && browser?.isConnected()) errors.push(`${url.pathname}: ${error.message.split('\n')[0]}`)
        await route.abort('failed').catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  await installYouTubeTransitionFixture(context, path.join(data, 'song.mp4'))
  await context.addInitScript((catalog) => {
    const kinds = new Map(catalog.map(clip => [clip.checksum, clip.kind ?? 'voice']))
    const decoded = new WeakMap()
    const active = new Map()
    const musicGains = new WeakMap()
    const musicMeters = new WeakMap()
    const createMediaSource = AudioContext.prototype.createMediaElementSource
    AudioContext.prototype.createMediaElementSource = function (element) {
      const source = createMediaSource.call(this, element)
      const connect = source.connect.bind(source)
      source.connect = (...args) => {
        if (args[0] instanceof GainNode) {
          musicGains.set(element, args[0])
          const meter = this.createAnalyser()
          meter.fftSize = 256
          args[0].connect(meter)
          musicMeters.set(element, meter)
        }
        return connect(...args)
      }
      return source
    }
    window.transitionTrace = { starts: [], music: [], musicSamples: [], visual: 0, active: [], levels: () => [...active.keys()].map(node => ({ kind: active.get(node), volume: node.fixtureGain?.gain.value })) }
    const update = () => {
      window.transitionTrace.active = [...active.values()]
    }
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = async function (bytes) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      const buffer = await decode.call(this, bytes)
      decoded.set(buffer, kinds.get(hash) || 'unknown')
      return buffer
    }
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (...args) {
      const node = create.apply(this, args)
      const start = node.start.bind(node)
      const connect = node.connect.bind(node)
      node.connect = (...args) => {
        if (args[0] instanceof GainNode) node.fixtureGain = args[0]
        return connect(...args)
      }
      const disconnect = node.disconnect.bind(node)
      node.start = (...args) => {
        const kind = decoded.get(node.buffer) || 'unknown'
        window.transitionTrace.starts.push({ kind, active: [...active.values()], at: performance.now() })
        active.set(node, kind)
        update()
        return start(...args)
      }
      node.disconnect = (...args) => {
        active.delete(node)
        update()
        return disconnect(...args)
      }
      node.addEventListener('ended', () => {
        active.delete(node)
        update()
      })
      return node
    }
    document.addEventListener('playing', (event) => {
      if (!(event.target instanceof HTMLMediaElement)) return
      if (event.target.dataset.mediaRole === 'transition-background') window.transitionTrace.visual++
      else {
        window.transitionTrace.music.push({ at: performance.now(), active: [...active.values()], volume: musicGains.get(event.target)?.gain.value ?? event.target.volume,
          gainRegistered: musicGains.has(event.target), transitionVisible: !!document.querySelector('[data-testid="transition-scene"]') })
        const meter = musicMeters.get(event.target)
        if (meter) for (let delay = 20; delay <= 500; delay += 20) setTimeout(() => {
          const samples = new Float32Array(meter.fftSize)
          meter.getFloatTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
          window.transitionTrace.musicSamples.push({ rms, active: [...active.values()] })
        }, delay)
      }
    }, true)
  }, catalog)
  player = await context.newPage()
  player.on('pageerror', error => errors.push(error.message))
  player.on('console', (message) => {
    if (message.type() === 'error' && /Warning:|Minified React error/.test(message.text())) errors.push(message.text())
  })
  await player.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/admin/settings/animator?view=background')}`)
  await player.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await player.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await player.getByPlaceholder('contraseña', { exact: true }).fill('transition-player-test')
  await player.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const sound = player.getByRole('region', { name: 'Sonido de pausa del reproductor', exact: true })
  const selection = sound.getByRole('combobox', { name: 'Ambiente a reproducir', exact: true })
  await expect(selection).toBeEnabled()
  await expect(selection).toHaveValue('')
  await selection.selectOption(bed.id)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.prefs.ambienceClipId).toBe(bed.id)
  await player.reload()
  await expect(selection).toBeEnabled()
  await expect(selection).toHaveValue(bed.id)
  await selection.focus()
  await selection.press('Home')
  await selection.press('Enter')
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.prefs.ambienceClipId).toBeNull()
  await expect(selection).toBeEnabled()
  await selection.selectOption(bed.id)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.prefs.ambienceClipId).toBe(bed.id)
  for (const width of [1440, 390]) {
    await player.setViewportSize({ width, height: 1000 })
    await sound.scrollIntoViewIfNeeded()
    await sound.screenshot({ path: path.join(data, `ambience-selection-${width}.png`) })
    assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  await player.route('**/api/animation/catalog', route => route.fulfill({ json: catalog.filter(clip => clip.id !== bed.id) }))
  await player.reload()
  await expect(sound.getByText(/El ambiente seleccionado ya no está disponible/)).toBeVisible()
  await expect(selection).toHaveValue(bed.id)
  await player.unroute('**/api/animation/catalog')
  await player.setViewportSize({ width: 1440, height: 1000 })
  await player.goto(`${uiBase}player`)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(bed.checksum), { timeout: 15000 }).toBe(true)
  await player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(player.getByTestId('transition-scene')).toBeVisible()
  await expect.poll(() => player.evaluate(() => window.transitionTrace.active.includes('ambience'))).toBe(true)
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(() => player.evaluate(() => window.transitionTrace.active.length)).toBe(0)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience).toBeNull()
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, 0, 'pausing the intro must not start or reserve speech')
  await emit('server/PLAYER_REQ_PLAY')
  await expect(player.getByTestId('transition-scene')).toBeVisible()
  await player.locator('video[data-media-role="transition-background"]').evaluate((element) => {
    window.introVideo = element
  })
  await expect.poll(() => active()?.status).toBe('PLAYING')
  const first = active()
  await expect(player.getByTestId('transition-scene')).toHaveAttribute('data-scene-id', first.interventionId)
  const decoration = player.locator('video[data-media-role="transition-background"]')
  assert.equal(await decoration.evaluate(element => element === window.introVideo), true, 'the intro and voice share one uninterrupted video element')
  const introTiming = await player.evaluate(() => {
    const trace = window.transitionTrace.starts
    const voice = trace.find(event => event.kind === 'voice')
    return voice.at - trace.filter(event => event.kind === 'ambience' && event.at < voice.at).at(-1).at
  })
  assert.ok(introTiming >= 1950 && introTiming < 4500, `Expected a two-second ambience intro; received ${Math.round(introTiming)} ms`)
  await expect.poll(() => decoration.evaluate(video => video.videoWidth > 0 && !video.paused)).toBe(true)
  await expect(player.getByTestId('announcement-overlay')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(decoration).toHaveCSS('opacity', '1')
  assert.equal((await emit('server/ANIMATION_SYNC')).payload.ambience?.clip.id, bed.id)
  assert.ok(JSON.parse(first.sequenceJSON).some(asset => asset.kind === 'effect'))
  const originalNode = await decoration.elementHandle()
  await call('animation/background/', { videoId: background.id, dimOpacity: 0.7, revision: 1 }, 'PUT')
  assert.equal(await decoration.evaluate(video => video.parentElement.querySelector('div[aria-hidden="true"]').style.opacity), '0.55')
  await player.screenshot({ path: path.join(data, 'transition-start.png') })
  await player.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => player.locator('#player-fs-container').evaluate(element => element.clientWidth)).toBe(390)
  await player.screenshot({ path: path.join(data, 'transition-mobile.png') })
  assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await player.setViewportSize({ width: 1440, height: 1000 })
  await expect.poll(() => player.locator('#player-fs-container').evaluate(element => element.clientWidth)).toBe(1440)
  await expect.poll(() => songStatus(1), { timeout: 15000 }).toBe('PLAYING')
  await expect.poll(() => originalNode.evaluate(video => video.paused && !video.hasAttribute('src'))).toBe(true)
  await expect.poll(() => active()?.sourceEventKey?.includes(':ended:1'), { timeout: 15000 }).toBe(true)
  const between = active()
  await expect(player.getByTestId('transition-scene')).toHaveAttribute('data-scene-id', between.interventionId)
  assert.equal(await decoration.evaluate(video => video.parentElement.querySelector('div[aria-hidden="true"]').style.opacity), '0.7')
  await player.screenshot({ path: path.join(data, 'between-songs.png') })
  await expect.poll(() => songStatus(2), { timeout: 15000 }).toBe('PLAYING')
  const trace = await player.evaluate(() => window.transitionTrace)
  assert.ok(trace.starts.some(event => event.kind === 'voice' && event.active.includes('ambience')))
  assert.ok(trace.starts.some(event => event.kind === 'effect' && event.active.includes('ambience')))
  assert.ok(trace.music.filter(event => !event.gainRegistered).every(event => event.active.length === 0 || event.volume === 0), 'native media stays muted beneath the transition')
  assert.ok(trace.musicSamples.some(sample => sample.rms > 0.001), 'the music output probe must observe real audio after handoff')
  assert.ok(trace.musicSamples.every(sample => sample.rms < 0.001 || sample.active.length === 0), 'decoded music becomes audible only after the transition bed stops')
  assert.ok(trace.starts.every(event => event.kind === 'ambience' || !event.active.some(kind => kind === 'voice' || kind === 'effect')), 'foreground clips never overlap each other')
  assert.ok(trace.visual > 0)
  assert.equal(db.prepare('SELECT count(*) n FROM audioUsage WHERE clipId=?').get(effect.id).n, 2)
  await expect.poll(() => songStatus(2), { timeout: 10000 }).toBe('PLAYED')
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience?.clip.id, { timeout: 15000 }).toBe(bed.id)
  snapshot = (await emit('server/ANIMATION_SYNC')).payload
  assert.equal(snapshot.ambience.rotate, false)
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, ambienceClipId: alternateBed.id })
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience?.clip.id, { timeout: 15000 }).toBe(alternateBed.id)
  snapshot = (await emit('server/ANIMATION_SYNC')).payload
  assert.equal(snapshot.ambience.rotate, false)
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, ambienceClipId: null })
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience?.rotate, { timeout: 15000 }).toBe(true)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience?.clip.id, { timeout: 20000 }).toBe(bed.id)
  snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, automation: false })
  await emit('server/PLAYER_REQ_PAUSE')
  await player.route('**/animation/background/videos/*/video', route => route.fulfill({ status: 503, body: 'unavailable' }))
  for (let index = 0; index < 2; index++) await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => songStatus(3)).toBe('PLAYING')
  await emit('server/ANIMATION_REQUEST', { requestId: crypto.randomUUID(), clipId: voice.id })
  await expect(player.locator('[data-testid="transition-scene"] [data-playback="failed"]')).toBeVisible({ timeout: 15000 })
  await expect(player.getByTestId('announcement-overlay')).toContainText('La próxima canción')
  await expect.poll(() => songStatus(4), { timeout: 15000 }).toBe('PLAYING')
  await player.unroute('**/animation/background/videos/*/video')
  await emit('server/ANIMATION_REQUEST', { requestId: crypto.randomUUID(), clipId: voice.id })
  await expect.poll(() => active()?.status, { timeout: 12000 }).toBe('PLAYING')
  const interruptedId = active().interventionId
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(() => db.prepare('SELECT status FROM animationInterventions WHERE interventionId=?').get(interruptedId).status).toBe('INTERRUPTED')
  await expect.poll(() => player.evaluate(() => window.transitionTrace.active.length)).toBe(0)
  await expect.poll(() => decoration.evaluate(video => video.paused).catch(() => true)).toBe(true)
  const abandoned = await decoration.elementHandle()
  await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  if (abandoned) await expect.poll(() => abandoned.evaluate(video => video.paused && !video.hasAttribute('src'))).toBe(true)
  await checkAmbienceHandoff({ player, uiBase, emit, db, bed, voice: volumeVoice, httpsUi })
  assert.deepEqual(errors, [])
  console.log(`PASS video + concurrent ambience + sequential voice/effects, natural boundaries, frozen settings, music handoff, video failure and pause/exit cleanup (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS frontend with isolated API/socket' : ''}). Artifacts: ${data}`)
} catch (error) {
  if (player && !player.isClosed()) {
    await player.screenshot({ path: path.join(data, 'failure.png') })
    console.error({ url: player.url(), errors, artifacts: data })
  }
  throw error
} finally {
  socket?.close()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
