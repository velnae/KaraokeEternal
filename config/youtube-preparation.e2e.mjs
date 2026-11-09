import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { capturePlaybackTrace } from './diagnostics/capture.js'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const realYouTube = process.env.KARAOKE_E2E_REAL_YOUTUBE === '1'
const reducedMotion = process.env.KARAOKE_E2E_REDUCED_MOTION === '1'
const delayedAcknowledgments = process.env.KARAOKE_E2E_DELAYED_ACKS === '1'
const latePlaybackReceipts = process.env.KARAOKE_E2E_LATE_PLAYBACK_RECEIPTS === '1'
const diagnostics = process.env.KARAOKE_E2E_DIAGNOSTICS === '1'
const soundPermission = diagnostics || process.env.KARAOKE_E2E_SOUND_PERMISSION === '1'
assert.ok(!diagnostics || !httpsUi, 'Diagnostic fault injection requires the isolated WebSocket frontend')
assert.ok(!latePlaybackReceipts || !httpsUi, 'Late-receipt injection requires the isolated WebSocket frontend')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-preparation-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const uiBase = httpsUi ? 'https://dev-karaoke.puyu.pe/' : `${origin}/`
const api = await request.newContext()
let server, browser, context, page, socket, db
let diagnosticConnection
let rejectedGreeting = false
const errors = []
const diagnosticLogs = []
const audioFailure = 'Diagnostic audio preparation failure'
const greetingFailure = 'Diagnostic greeting timeout'
const commandFailure = 'Diagnostic cancellation timeout'
const videos = ['M7lc1UVf-VE', 'aqz-KE-bpKQ', 'M7lc1UVf-VE', 'aqz-KE-bpKQ']
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${origin}/api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(4000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 3000 } })
  assert.ok(!response.error, response.error)
  return response
}
const uploadAudio = async (id, kind, family, seconds, frequency) => {
  const texts = {
    'turn': 'La próxima canción ya está lista.',
    'closing-one': 'Gracias por cantar. Seguimos con la próxima canción.',
    'closing-two': 'Un aplauso para quien acaba de cantar.',
    'closing-three': 'La música continúa con otro gran tema.',
  }
  const file = path.join(data, `${id}.wav`)
  const input = id === 'turn' && process.env.KARAOKE_E2E_VOICE_FILE
    ? ['-i', process.env.KARAOKE_E2E_VOICE_FILE]
    : ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', String(seconds)]
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...input, file])
  const response = await api.post(`${origin}/api/animation/resources/upload`, { multipart: {
    requestId: id, title: id, kind, metadata: JSON.stringify({ text: texts[id] ?? 'Recurso de transición.', family,
      modes: ['mixed'], category: kind === 'effect' ? 'transition' : '', effectType: kind === 'effect' ? 'transition' : undefined,
      loop: kind === 'ambience' ? true : undefined }),
    file: { name: `${id}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(file) },
  } })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}

try {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      DEV_PLAYER_TOOLS: diagnostics ? 'true' : process.env.DEV_PLAYER_TOOLS ?? 'false',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. Logs: ${data}`)
    try {
      return (await api.get(`${origin}/api/prefs`)).status()
    } catch {
      return 0
    }
  }, { timeout: 120000 }).toBe(200)
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'youtube-preparation-test', newPasswordConfirm: 'youtube-preparation-test' })
  await call('login', { username: 'admin', password: 'youtube-preparation-test', roomId: 1 })
  const bed = await uploadAudio('pause-bed', 'ambience', 'manual', 7, 110)
  await uploadAudio('turn', 'voice', 'turn', latePlaybackReceipts ? 6 : 2, 330)
  await uploadAudio('closing-one', 'voice', 'closing', 2, 440)
  await uploadAudio('closing-two', 'voice', 'closing', 2, 550)
  await uploadAudio('closing-three', 'voice', 'closing', 2, 660)
  await uploadAudio('curtain', 'effect', 'manual', 0.8, 770)
  const catalog = await call('animation/catalog')
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  for (const [index, id] of videos.entries()) {
    db.prepare(`INSERT INTO queue(roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin)
      VALUES(1,1,?,'YOUTUBE',?,?,'Fixture','OPERATOR')`).run(index || null, id, `Preparation ${index + 1}`)
  }
  for (const [name, duration] of [['background', 1], ['song', 8]]) {
    const source = name === 'background' ? 'testsrc2=size=320x180:rate=10' : 'color=c=blue:s=320x180:r=10'
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
      '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', String(duration), '-c:v', 'libx264', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, `${name}.mp4`)])
  }
  const upload = await api.post(`${origin}/api/animation/background/upload`, { multipart: {
    requestId: crypto.randomUUID(), file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'background.mp4')) },
  } })
  assert.equal(upload.status(), 202, await upload.text())
  const background = await upload.json()
  await expect.poll(async () => (await call(`animation/background/videos/${background.id}`)).state).toBe('ready')
  await call('animation/background/', { videoId: background.id, dimOpacity: 0.55, revision: 0 }, 'PUT')
  await call('animation/background/', { mode: 'all', videoId: null, dimOpacity: 0.55, revision: 1 }, 'PUT')
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  const snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true,
    ambienceEnabled: true, ambienceClipId: bed.id, volume: 0.5, ambienceVolume: 0.2,
    events: { welcome: false, turn: true, closing: true, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
  await emit('server/ANIMATION_SESSION', { operation: 'open' })

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
    headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await api.storageState(),
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  if ((delayedAcknowledgments || latePlaybackReceipts || diagnostics) && !httpsUi) await context.routeWebSocket('**/socket.io/**', (client) => {
    diagnosticConnection = client
    const upstream = client.connectToServer()
    const delayed = new Set()
    const lateReceipts = new Set()
    client.onMessage((message) => {
      const match = String(message).match(/^42(\d+)\[/)
      if (diagnostics && match) {
        const [, action] = JSON.parse(String(message).slice(String(message).indexOf('[')))
        if (action.type === 'server/ANIMATION_CANCEL') {
          client.send(`43${match[1]}${JSON.stringify([{ error: commandFailure }])}`)
          return
        }
        if (!rejectedGreeting && action.type === 'server/GREETINGS' && action.payload.operation === 'reserve') {
          rejectedGreeting = true
          client.send(`43${match[1]}${JSON.stringify([{ error: greetingFailure }])}`)
          return
        }
      }
      if (delayedAcknowledgments && match && /server\/(PLAYER_EMIT_STATUS|ANIMATION_AUTO|ANIMATION_RESERVE)/.test(String(message))) delayed.add(match[1])
      if (latePlaybackReceipts && match) {
        const [, action] = JSON.parse(String(message).slice(String(message).indexOf('[')))
        if (action.type === 'server/ANIMATION_EVENT' && ['STARTED', 'ASSET_STARTED'].includes(action.payload.event)) lateReceipts.add(match[1])
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const match = String(message).match(/^43(\d+)\[/)
      if (match && lateReceipts.delete(match[1])) setTimeout(() => client.send(message), 1800)
      else if (match && delayed.delete(match[1])) setTimeout(() => client.send(message), 650)
      else client.send(message)
    })
  })
  if (diagnostics) await context.route('**/api/animation/preparation', route => route.fulfill({ status: 503, contentType: 'text/plain', body: audioFailure }))
  if (httpsUi) {
    // Only HTML/JS/CSS use the tunnel. All room mutations go to isolated data.
    await context.route(/https:\/\/dev-karaoke\.puyu\.pe\/(api|socket\.io)\//, async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      try {
        const response = await api.fetch(`${origin}${url.pathname}${url.search}`, {
          method: incoming.method(), data: incoming.postDataBuffer() ?? undefined,
          headers: { 'accept-encoding': 'identity', ...(incoming.headers()['content-type'] ? { 'content-type': incoming.headers()['content-type'] } : {}) },
        })
        if (url.pathname.startsWith('/socket.io/') && incoming.method() === 'GET' && !url.searchParams.has('sid')) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          await route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch (error) {
        if (page && !page.isClosed() && browser?.isConnected()) errors.push(`${url.pathname}: ${error.message.split('\n')[0]}`)
        await route.abort('failed').catch(() => {})
      }
    })
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  if (!realYouTube) await context.route('**/youtube-preparation-fixture.mp4', route => route.fulfill({ path: path.join(data, 'song.mp4'), contentType: 'video/mp4' }))
  await context.addInitScript(({ realYouTube, catalog }) => {
    const probe = window.youtubePreparation = { players: [], commands: [], states: [], audio: [], frames: [], contexts: [], blockAudio: false }
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function () {
      return probe.blockAudio ? Promise.reject(new Error('Fixture audio permission required')) : resume.call(this)
    }
    const allowSound = (event) => {
      if (event.target.closest?.('button')?.textContent === 'Permitir sonido') probe.blockAudio = false
    }
    document.addEventListener('click', allowSound, true)
    document.addEventListener('keydown', allowSound, true)
    let hadScene = false
    const recordFrame = (at) => {
      const scene = document.querySelector('[data-testid="transition-scene"]')
      const youtube = document.querySelector('[data-youtube-mode]')
      const incoming = scene?.querySelector('[data-testid="transition-incoming"]')
      if (scene || hadScene) probe.frames.push({ at, scene: !!scene,
        opacity: scene ? Number(getComputedStyle(scene).opacity) : null, exiting: scene?.dataset.exiting === 'true',
        incoming: incoming?.dataset.queueId,
        notice: /Preparando la próxima canción|Reproducción en pausa/.test(scene?.textContent ?? ''), width: innerWidth,
        youtube: youtube?.dataset.youtubeVideoId, mode: youtube?.dataset.youtubeMode,
        position: probe.players.at(-1)?.getCurrentTime?.() ?? 0 })
      hadScene = !!scene
      requestAnimationFrame(recordFrame)
    }
    requestAnimationFrame(recordFrame)
    const clips = new Map(catalog.map(clip => [clip.checksum, clip]))
    const decoded = new WeakMap()
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = async function (bytes) {
      if (!probe.contexts.includes(this)) probe.contexts.push(this)
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      const buffer = await decode.call(this, bytes)
      decoded.set(buffer, clips.get(checksum))
      return buffer
    }
    const createSource = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args)
      const start = node.start.bind(node)
      const connect = node.connect.bind(node)
      let run, output, meter, sampleTimer
      node.connect = (...values) => {
        output = values[0]
        return connect(...values)
      }
      node.addEventListener('ended', () => {
        if (run) run.endedAt = performance.now()
        clearInterval(sampleTimer)
        meter?.disconnect()
      })
      node.start = (...values) => {
        const clip = decoded.get(node.buffer)
        run = { kind: clip?.kind, clipId: clip?.id, durationMs: clip?.durationMs,
          at: performance.now(), endedAt: null, scene: !!document.querySelector('[data-testid="transition-scene"]'),
          peakRms: 0, audibleSamples: 0, contextState: this.state }
        probe.audio.push(run)
        // Measure after the gain, not merely whether a source was scheduled.
        meter = this.createAnalyser()
        output.connect(meter)
        const samples = new Float32Array(meter.fftSize)
        sampleTimer = setInterval(() => {
          meter.getFloatTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
          run.peakRms = Math.max(run.peakRms, rms)
          if (rms > 0.005) run.audibleSamples++
        }, 50)
        return start(...values)
      }
      return node
    }
    const record = (command, videoId, player) => probe.commands.push({ command, videoId, at: performance.now(),
      position: player.getCurrentTime(), scene: !!document.querySelector('[data-testid="transition-scene"]'),
      mode: document.querySelector('[data-youtube-mode]')?.dataset.youtubeMode })
    const instrument = Player => new Proxy(Player, {
      construct (Target, args) {
        const options = args[1]
        const stateChange = options.events.onStateChange
        options.events.onStateChange = (event) => {
          probe.states.push({ state: event.data, at: performance.now(), videoId: event.target.getVideoUrl?.() })
          stateChange(event)
        }
        const ready = options.events.onReady
        options.events.onReady = (event) => {
          const instance = event.target
          let videoId = options.videoId
          for (const method of ['cueVideoById', 'loadVideoById', 'playVideo', 'destroy']) {
            const original = instance[method].bind(instance)
            instance[method] = (...values) => {
              if (method === 'cueVideoById' || method === 'loadVideoById') videoId = values[0]
              record(method, videoId, instance)
              return original(...values)
            }
          }
          ready(event)
        }
        const instance = Reflect.construct(Target, args)
        probe.players.push(instance)
        return instance
      },
    })
    if (realYouTube) {
      let ready
      Object.defineProperty(window, 'onYouTubeIframeAPIReady', {
        configurable: true,
        get: () => ready,
        set: (callback) => {
          ready = () => {
            window.YT.Player = instrument(window.YT.Player)
            callback()
          }
        },
      })
    } else {
      window.YT = { PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 }, Player: instrument(class {
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

        // Unlike an HTML video preload, cue must not download the media.
        cueVideoById (videoId) {
          this.videoId = videoId
          this.video.pause()
          this.video.removeAttribute('src')
          this.video.load()
          setTimeout(() => this.options.events.onStateChange({ target: this, data: 5 }), 200)
        }

        loadVideoById (videoId) {
          this.videoId = videoId
          this.video.pause()
          this.video.removeAttribute('src')
          this.video.load()
          this.playVideo()
        }

        playVideo () {
          if (!this.video.hasAttribute('src')) this.video.src = '/youtube-preparation-fixture.mp4'
          void this.video.play().catch(() => this.options.events.onAutoplayBlocked({ target: this }))
        }

        pauseVideo () { this.video.pause() }
        seekTo (seconds) { this.video.currentTime = seconds }
        getCurrentTime () { return this.video.currentTime }
        getVideoUrl () { return `https://www.youtube.com/watch?v=${this.videoId}` }
        getDuration () { return this.video.duration }
        getPlayerState () { return this.video.ended ? 0 : this.video.paused ? 2 : 1 }
        setVolume (volume) { this.video.volume = volume / 100 }
        setSize () {}
        destroy () {
          this.video.pause()
          this.video.removeAttribute('src')
          this.video.load()
        }
      }) }
    }
  }, { realYouTube, catalog })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', async (message) => {
    if (message.text().startsWith('[player]')) diagnosticLogs.push(await message.args()[1].jsonValue())
  })
  await page.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/player')}`)
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('youtube-preparation-test')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Controles de reproducción' })
  const keyboard = async (name) => {
    const button = toolbar.getByRole('button', { name, exact: true })
    await button.focus()
    await button.press('Enter')
  }
  const status = id => db.prepare('SELECT status FROM queue WHERE queueId=?').get(id)?.status
  const position = () => page.evaluate(() => window.youtubePreparation.players.at(-1)?.getCurrentTime?.() ?? 0)
  const playbackState = () => page.evaluate(() => window.youtubePreparation.players.at(-1)?.getPlayerState?.())
  const finishNaturally = async () => {
    if (realYouTube) await page.evaluate(() => {
      const player = window.youtubePreparation.players.at(-1)
      player.seekTo(player.getDuration() - 0.7, true)
    })
  }
  const assertFullTransition = async (since, label, verifyFade = true) => {
    const { commands, audio } = await page.evaluate(() => ({ commands: window.youtubePreparation.commands, audio: window.youtubePreparation.audio }))
    // A cold iframe API may become ready only after the transition; its first
    // active load is valid. Later handoffs still assert reuse of the prepared cue.
    const play = commands.find(command => command.at > since && ['playVideo', 'loadVideoById'].includes(command.command))
    assert.ok(play, `${label}: expected a playback command`)
    const parts = audio.filter(run => run.at > since && run.at < play.at)
    const voice = parts.find(run => run.kind === 'voice')
    const curtain = parts.find(run => run.kind === 'effect')
    const ambience = parts.find(run => run.kind === 'ambience')
    assert.ok(voice && curtain && ambience, `${label}: missing a transition part: ${parts.map(run => run.kind).join(', ')}`)
    assert.equal(voice.contextState, 'running', `${label}: voice requires a running audio context`)
    assert.ok(voice.peakRms > 0.01 && voice.audibleSamples >= voice.durationMs / 100,
      `${label}: voice must have a sustained non-silent signal after gain: ${JSON.stringify(voice)}`)
    assert.equal(db.prepare('SELECT status FROM animationInterventions ORDER BY requestedAt DESC LIMIT 1').get().status, 'PLAYED',
      `${label}: the server must acknowledge the complete intervention`)
    if (latePlaybackReceipts) {
      const trace = await page.evaluate(() => window.karaokePlaybackTrace.snapshot())
      assert.ok(trace.events.some(event => event.event === 'playback-receipt-reconciled' && event.monotonicMs > since),
        `${label}: late receipt must be reconciled against a confirmed live grant`)
    }
    assert.ok(parts.every(run => run.scene), `${label}: the background must cover the entire sequence`)
    assert.ok(voice.at >= ambience.at + 1900, `${label}: ambience introduces the voice`)
    assert.ok(voice.endedAt >= voice.at + voice.durationMs - 100 && voice.endedAt <= curtain.at, `${label}: voice finishes before the curtain`)
    assert.ok(ambience.endedAt <= curtain.at, `${label}: the curtain plays without ambience`)
    assert.ok(curtain.endedAt >= curtain.at + curtain.durationMs - 100 && curtain.endedAt <= play.at, `${label}: the curtain finishes before YouTube starts`)
    assert.equal(play.scene, true, `${label}: YouTube starts before the visual scene retires`)
    if (verifyFade) {
      await expect(page.getByTestId('transition-scene')).toHaveCount(0)
      await expect.poll(() => page.evaluate(at => window.youtubePreparation.frames.some(frame => !frame.scene && frame.at > at), play.at)).toBe(true)
      const probe = await page.evaluate(() => ({ frames: window.youtubePreparation.frames, states: window.youtubePreparation.states }))
      const started = probe.states.find(state => state.state === 1 && state.at >= play.at)
      const hidden = probe.frames.find(frame => !frame.scene && frame.at >= started.at)
      assert.ok(hidden, `${label}: the outgoing scene must retire`)
      const elapsed = hidden.at - started.at
      if (reducedMotion) assert.ok(elapsed < 400, `${label}: reduced motion must finish without waiting for CSS events (${Math.round(elapsed)} ms)`)
      else {
        assert.ok(elapsed >= 950 && elapsed < 1600, `${label}: expected a one-second overlap, received ${Math.round(elapsed)} ms`)
        const fade = probe.frames.filter(frame => frame.at >= started.at && frame.at <= hidden.at && frame.scene)
        assert.ok(fade.some(frame => frame.opacity > 0.1 && frame.opacity < 0.9), `${label}: intermediate opacity must actually be painted`)
        assert.ok(fade.some(frame => frame.opacity < 0.1), `${label}: the fade must finish before removing the scene`)
        assert.ok(fade.every(frame => frame.mode === 'active'), `${label}: YouTube stays visible/active throughout the fade`)
        assert.ok(fade.at(-1).position >= 0.5, `${label}: YouTube must progress during the outgoing visual effect`)
        assert.equal(new Set(fade.map(frame => frame.incoming)).size, 1, `${label}: the outgoing title must not jump to the following song`)
      }
    }
  }
  const checkDiagnostic = async (source, text) => {
    await expect.poll(() => diagnosticLogs.some(log => log.source === source && log.message.includes(text))).toBe(true)
    if (development) await expect(page.getByRole('list', { name: 'Diagnóstico del reproductor' })).toContainText(text)
    else {
      await expect(page.getByRole('complementary', { name: 'Herramientas de desarrollo' })).toHaveCount(0)
      await expect(page.locator('body')).not.toContainText(text)
    }
  }
  if (diagnostics) {
    await expect(page.getByRole('button', { name: 'Reintentar audio', exact: true })).toBeVisible()
    await checkDiagnostic('animation', audioFailure)
    await page.setViewportSize({ width: 390, height: 900 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(600)
    assert.equal(diagnosticLogs.filter(log => log.source === 'animation' && log.message === audioFailure).length, 1, 'rerenders must not flood the log')
    diagnosticConnection.send(`42${JSON.stringify(['action', { type: 'diagnostic/ERROR', error: 'Diagnostic global failure' }])}`)
    await checkDiagnostic('interface', 'Diagnostic global failure')
    await expect(page.getByRole('dialog', { name: 'Ocurrió un error' })).toHaveCount(0)
    await context.unroute('**/api/animation/preparation')
    await page.getByRole('button', { name: 'Reintentar audio', exact: true }).focus()
    await page.keyboard.press('Enter')
  }
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(bed.checksum), { timeout: 15000 }).toBe(true)
  if (soundPermission) {
    await page.evaluate(async () => {
      window.youtubePreparation.blockAudio = true
      await Promise.all(window.youtubePreparation.contexts.map(context => context.suspend()))
    })
    const permission = page.getByRole('button', { name: 'Permitir sonido', exact: true })
    await expect(permission).toBeVisible()
    await expect(page.getByText('Activa el sonido', { exact: true })).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.locator('#player-fs-container')).toHaveCSS('width', `${width}px`)
      await expect.poll(() => permission.evaluate((button) => {
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && button.contains(hit)
      })).toBe(true)
      await page.screenshot({ path: path.join(data, `sound-permission-${width}.png`) })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await permission.focus()
    await page.keyboard.press('Enter')
    await expect(permission).toHaveCount(0)
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  }
  if (diagnostics) {
    await page.evaluate(() => {
      document.getElementById('player-fs-container').requestFullscreen = () => Promise.reject(new Error('Fixture fullscreen failure'))
    })
    await page.getByRole('button', { name: 'Activar pantalla completa', exact: true }).click()
    await expect(page.getByText('No se pudo abrir la pantalla completa. Intenta de nuevo.', { exact: true })).toBeVisible()
    await checkDiagnostic('interface', 'No se pudo activar la pantalla completa.')
    await page.evaluate(() => {
      delete document.getElementById('player-fs-container').requestFullscreen
    })
  }
  const captureVisualSequence = async () => {
    if (reducedMotion) return
    const scene = page.getByTestId('transition-scene')
    await expect(scene).toBeVisible()
    await page.waitForTimeout(80)
    await page.screenshot({ path: path.join(data, 'entry-start.png') })
    await page.waitForTimeout(140)
    await page.screenshot({ path: path.join(data, 'entry-end.png') })
    await expect(scene).toHaveAttribute('data-exiting', 'true', { timeout: 45000 })
    await page.screenshot({ path: path.join(data, 'fade-start.png') })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(data, 'fade-middle.png') })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(data, 'fade-end.png') })
  }
  let captureError
  const visualCapture = captureVisualSequence().catch((error) => {
    captureError = error
  })
  const cancellationCheck = (async () => {
    if (!diagnostics) return
    const stop = page.getByRole('button', { name: 'Detener anuncio', exact: true })
    await expect(stop).toBeVisible({ timeout: 15000 })
    await stop.focus()
    await stop.press('Enter')
    await checkDiagnostic('interface', commandFailure)
    await expect(page.getByText('No se pudo detener el anuncio. Intenta de nuevo.', { exact: true })).toBeVisible()
  })().catch((error) => {
    captureError = error
  })
  const firstBoundary = await page.evaluate(() => performance.now())
  await keyboard('Reproducir')
  if (!reducedMotion) {
    const backdrop = page.locator('video[data-media-role="transition-background"]')
    await expect(backdrop).toHaveCSS('opacity', '1')
    await backdrop.dispatchEvent('stalled')
    await expect(page.locator('[data-playback="buffering"]')).toHaveAttribute('data-video-visible', 'true')
    await expect(backdrop).toHaveCSS('opacity', '1')
    await page.screenshot({ path: path.join(data, 'transition-background.png') })
  }
  await expect.poll(position, { timeout: 45000 }).toBeGreaterThan(0.2)
  await assertFullTransition(firstBoundary, 'Initial playback')
  await visualCapture
  await cancellationCheck
  if (diagnostics) await checkDiagnostic('greeting', greetingFailure)
  if (captureError) throw captureError
  await page.evaluate(() => {
    window.firstPreparedPlayer = window.youtubePreparation.players.at(-1)
  })
  await keyboard('Pausar')
  await expect.poll(playbackState).toBe(2)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: path.join(data, `youtube-${width}.png`) })
  }
  await keyboard('Reproducir')
  await expect.poll(playbackState).toBe(1)
  await finishNaturally()
  await expect(page.locator(`[data-youtube-mode="preparing"][data-youtube-video-id="${videos[1]}"]`)).toHaveCount(1, { timeout: 15000 })
  assert.equal(status(2), 'APPROVED', 'cueing must not start the reserved queue item')
  await keyboard('Pausar')
  await page.waitForTimeout(2300)
  await page.screenshot({ path: path.join(data, 'transition-paused-mobile.png') })
  assert.equal(status(2), 'APPROVED', 'pause during preparation must prevent promotion')
  const resumedBoundary = await page.evaluate(() => performance.now())
  await keyboard('Reproducir')
  await expect.poll(() => status(2), { timeout: 15000 }).toBe('PLAYING')
  await expect.poll(position, { timeout: 45000 }).toBeGreaterThan(0.2)
  await assertFullTransition(resumedBoundary, 'Resumed between-song transition')
  const frames = await page.evaluate(() => window.youtubePreparation.frames)
  for (const width of [1440, 390]) {
    const scenes = frames.filter(frame => frame.width === width && frame.scene)
    assert.ok(scenes.length > 0, `${width}px: exercise the transition presentation`)
    assert.ok(scenes.every(frame => !frame.notice), `${width}px: transient notices must never appear`)
  }
  assert.ok(await page.evaluate(() => window.firstPreparedPlayer === window.youtubePreparation.players.at(-1)), 'song-to-song handoff must preserve the player instance')
  const trace = await page.evaluate(() => window.youtubePreparation.commands)
  const second = trace.filter(command => command.videoId === videos[1])
  assert.ok(second.some(command => command.command === 'cueVideoById' && command.mode === 'preparing'))
  assert.ok(second.some(command => command.command === 'playVideo'))
  assert.ok(!second.some(command => command.command === 'loadVideoById'), 'promotion must reuse the cue, not reload it')
  assert.ok(trace.filter(command => command.command === 'playVideo').every(command => command.mode === 'active'), 'YouTube only starts after the audio sequence releases playback')
  const secondStart = second.find(command => command.command === 'playVideo')
  assert.ok(secondStart.position < 0.1, 'the opening must not be consumed during the announcement')
  if (!realYouTube) {
    await page.evaluate(() => {
      const player = window.youtubePreparation.players.at(-1)
      player.pauseVideo()
      player.options.events.onAutoplayBlocked({ target: player })
    })
    const retry = page.getByRole('button', { name: 'Reproducir aquí', exact: true })
    await expect(retry).toBeVisible()
    await retry.focus()
    await retry.press('Enter')
    await expect(retry).toHaveCount(0)
  }
  await emit('server/PLAYER_REQ_REPLAY', { queueId: 2 })
  await expect.poll(position).toBeLessThan(1)
  const nextBoundary = await page.evaluate(() => performance.now())
  await emit('server/PLAYER_REQ_NEXT')
  await expect.poll(() => status(3), { timeout: 15000 }).toBe('PLAYING')
  await expect.poll(position, { timeout: 45000 }).toBeGreaterThan(0.2)
  await assertFullTransition(nextBoundary, 'Play next after replay')
  const naturalBoundary = await page.evaluate(() => performance.now())
  await finishNaturally()
  await expect.poll(() => status(4), { timeout: 20000 }).toBe('PLAYING')
  await expect.poll(position, { timeout: 45000 }).toBeGreaterThan(0.2)
  await assertFullTransition(naturalBoundary, 'Natural song-to-song boundary', false)
  assert.ok(await page.evaluate(() => window.firstPreparedPlayer === window.youtubePreparation.players.at(-1)))
  const finalTrace = await page.evaluate(() => window.youtubePreparation.commands)
  const finalCue = finalTrace.filter(command => command.command === 'cueVideoById' && command.videoId === videos[3]).at(-1)
  const finalPlay = finalTrace.find(command => command.command === 'playVideo' && command.at > finalCue.at)
  assert.ok(finalPlay && finalPlay.at - finalCue.at >= 1900, 'an uninterrupted handoff prepares during the two-second intro')
  assert.equal(finalPlay.scene, true)
  assert.ok(finalPlay.position < 0.1)
  console.log(`YouTube preparation began ${Math.round(finalPlay.at - finalCue.at)} ms before playback; same player, start position ${finalPlay.position}`)
  // Cancel the final overlap. Its old completion must not affect later playback.
  if (!reducedMotion) await expect(page.getByTestId('transition-scene')).toHaveAttribute('data-exiting', 'true')
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(playbackState).toBe(2)
  await expect(page.getByTestId('transition-scene')).toHaveCount(0)
  const pausedAt = await position()
  await page.waitForTimeout(1200)
  assert.ok(Math.abs(await position() - pausedAt) < 0.1, 'an abandoned visual fade cannot resume playback')
  await keyboard('Reproducir')
  await expect.poll(playbackState).toBe(1)
  await page.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  if (diagnostics) await expect(page.getByRole('dialog', { name: 'Ocurrió un error' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.youtubePreparation.commands.some(command => command.command === 'destroy'))).toBe(true)
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(data, 'trace.json'), JSON.stringify(await page.evaluate(() => ({ commands: window.youtubePreparation.commands,
    audio: window.youtubePreparation.audio, frames: window.youtubePreparation.frames, states: window.youtubePreparation.states })), null, 2))
  console.log(`PASS full audio sequence, one-second visual crossfade, buffered background continuity, cancellation, same YouTube player and zero-position start (${httpsUi ? 'shared HTTPS frontend + isolated API' : development ? 'development StrictMode' : 'production'}, ${realYouTube ? 'real YouTube' : 'YouTube fixture'}${reducedMotion ? ', reduced motion' : ''}${diagnostics ? ', diagnostic visibility/logging and recovery' : soundPermission ? ', sound permission recovery' : ''}). Artifacts: ${data}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(data, 'failure.png') })
    console.error(JSON.stringify({ errors, artifacts: data, trace: await page.evaluate(() => ({ commands: window.youtubePreparation?.commands, audio: window.youtubePreparation?.audio,
      states: window.youtubePreparation?.states, position: window.youtubePreparation?.players.at(-1)?.getCurrentTime?.(),
      duration: window.youtubePreparation?.players.at(-1)?.getDuration?.() })).catch(() => []) }, null, 2))
  }
  throw error
} finally {
  await capturePlaybackTrace(page)
  socket?.close()
  await context?.close()
  await browser?.close()
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  db?.close()
  await api.dispose()
  fs.closeSync(log)
}
