import { expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function runGreetingPlaybackChecks ({ api, admin, adminContext, guestContext, db, base, data, first, second, call, connect, emit, job, ready, start, stop, setSpeech, setPlayer, installation }) {
  const pass = name => console.log(`PASS ${name}`)
  const upload = async (id, kind, seconds, frequency) => {
    const file = path.join(data, `${id}.wav`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', String(seconds), file])
    const response = await api.post(`${base}api/animation/resources/upload`, { multipart: {
      requestId: id, kind, title: id, metadata: JSON.stringify({ text: 'Antes de la canción, un saludo.', family: 'manual', modes: ['mixed'], loop: kind === 'ambience' ? true : undefined }),
      file: { name: `${id}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(file) },
    } })
    assert.equal(response.status(), 200, await response.text())
    const resource = await response.json()
    assert.equal(resource.preparation, 'ready')
    return resource.id
  }
  const introId = await upload('greeting-intro-short', 'voice', 0.8, 500)
  const longIntroId = await upload('greeting-intro-long', 'voice', 8, 600)
  const bedId = await upload('greeting-background', 'ambience', 34.5, 90)
  const uploadedBackground = await api.post(`${base}api/animation/background/upload`, { multipart: { requestId: 'greeting-visual',
    file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'song.mp4')) } } })
  assert.equal(uploadedBackground.status(), 202)
  const background = await uploadedBackground.json()
  await expect.poll(() => db.prepare('SELECT state FROM transitionVideos WHERE id=?').get(background.id)?.state).toBe('ready')
  await call(api, 'animation/background/', { videoId: background.id, dimOpacity: 0.55, revision: 0 }, 'PUT')
  const operator = await connect(api)
  const sound = (await emit(operator, 'server/ANIMATION_SYNC', {})).payload
  await emit(operator, 'server/ANIMATION_CONTROL', { controlVersion: sound.controlVersion, ambienceEnabled: true, ambienceVolume: 0.35, ambienceClipId: bedId })
  const guest = await connect(guestContext.request)
  const configure = async (introClipId) => {
    const snapshot = (await emit(operator, 'server/GREETINGS', { operation: 'read' })).payload
    await emit(operator, 'server/GREETINGS', { operation: 'playback', version: snapshot.playbackVersion, settings: { enabled: true, introClipId, ambienceEnabled: true } })
  }
  const add = async (message, requestIntent = 'SING') => {
    const reply = await emit(guest, 'server/QUEUE_ADD', { source: 'LOCAL', songId: 1, requestId: crypto.randomUUID(), requestIntent, greeting: { recipient: 'Rocío', message } })
    const item = db.prepare('SELECT * FROM greetings WHERE greetingId=?').get(reply.payload.greetingId)
    await ready(item.greetingId)
    return item
  }
  const delivery = item => db.prepare('SELECT * FROM greetingTurns WHERE turnKey=?').get(item.queueId)
  const intervention = item => db.prepare('SELECT * FROM animationInterventions WHERE interventionId=?').get(delivery(item)?.interventionId)
  const status = item => db.prepare('SELECT status FROM queue WHERE queueId=?').get(item.queueId).status
  const waitPlayed = item => expect.poll(() => status(item), { timeout: 15000 }).toBe('PLAYED')

  if (process.env.KES_TTS_TEST_INSTALLATION) {
    const config = (await call(api, 'prefs/local-tts')).config
    await call(api, 'prefs/local-tts', { ...config, installationPath: process.env.KES_TTS_TEST_INSTALLATION, autoStart: true }, 'PUT')
    await expect.poll(() => job(first.greetingId)?.profileJSON.includes(process.env.KES_TTS_TEST_INSTALLATION), { timeout: 15000 }).toBe(true)
    await expect.poll(() => job(first.greetingId)?.status, { timeout: 150000 }).toBe('ready')
    await ready(second.greetingId)
  }

  await admin.goto(`${base}admin/settings/animator?view=local-voice`)
  await admin.getByLabel('Presentación del saludo', { exact: true }).selectOption(introId)
  await expect.poll(() => JSON.parse(db.prepare('SELECT playbackJSON FROM greetingControls WHERE roomId=1').get().playbackJSON).introClipId).toBe(introId)
  const enable = admin.getByRole('checkbox', { name: 'Leer saludos en voz alta', exact: true })
  await expect(enable).toBeEnabled()
  await enable.focus()
  await admin.keyboard.press('Space')
  await expect(enable).toBeChecked()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await enable.scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `playback-controls-${width}.png`) })
  }
  db.prepare(`UPDATE queue SET source='LOCAL',songId=1,externalId=NULL WHERE queueId IN (?,?)`).run(first.queueId, second.queueId)

  await adminContext.addInitScript(() => {
    window.audioTrace = { events: [], decoded: [], next: 0 }
    const musicGains = new WeakMap()
    const mediaSource = AudioContext.prototype.createMediaElementSource
    AudioContext.prototype.createMediaElementSource = function (element) {
      const source = mediaSource.call(this, element)
      const connect = source.connect.bind(source)
      source.connect = (...args) => {
        if (args[0] instanceof GainNode) musicGains.set(element, args[0])
        return connect(...args)
      }
      return source
    }
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (...args) {
      const node = create.apply(this, args)
      const id = ++window.audioTrace.next
      const start = node.start.bind(node)
      const stop = node.stop.bind(node)
      node.start = (...values) => {
        window.audioTrace.events.push({ type: 'start', id, duration: node.buffer?.duration, at: performance.now() })
        return start(...values)
      }
      node.stop = (when) => {
        window.audioTrace.events.push({ type: 'stop', id, delay: Math.max(0, (when - this.currentTime) * 1000), at: performance.now() })
        return stop(when)
      }
      node.addEventListener('ended', () => window.audioTrace.events.push({ type: 'ended', id, at: performance.now() }))
      return node
    }
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = async function (bytes) {
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      const buffer = await decode.call(this, bytes)
      window.audioTrace.decoded.push({ duration: buffer.duration, checksum })
      return buffer
    }
    document.addEventListener('playing', (event) => {
      if (event.target instanceof HTMLMediaElement && event.target.dataset.mediaRole !== 'transition-background') window.audioTrace.events.push({ type: 'music', at: performance.now(), volume: musicGains.get(event.target)?.gain.value ?? event.target.volume })
    }, true)
  })
  const player = await adminContext.newPage()
  setPlayer(player)
  let networkDelayMs = 0
  let holdIdleProbe = false
  let releaseIdleProbe
  const protocol = []
  await player.routeWebSocket(/\/socket\.io\//, (socket) => {
    const upstream = socket.connectToServer()
    const actions = new Map()
    const timers = new Set()
    const forward = (target, message) => {
      if (!networkDelayMs) return target.send(message)
      const timer = setTimeout(() => {
        timers.delete(timer)
        target.send(message)
      }, networkDelayMs)
      timers.add(timer)
    }
    socket.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^42(\d+)(\[.*)$/)
      if (packet) {
        const action = JSON.parse(packet[2])[1]
        actions.set(packet[1], action)
        if (networkDelayMs) protocol.push({ direction: 'request', at: Date.now(), action })
        if (holdIdleProbe && action?.type === 'server/ANIMATION_AUTO' && action.payload?.probeOnly) {
          holdIdleProbe = false
          releaseIdleProbe = () => upstream.send(message)
          return
        }
      }
      forward(upstream, message)
    })
    upstream.onMessage((message) => {
      const packet = typeof message === 'string' && message.match(/^43(\d+)(\[.*)$/)
      if (packet) {
        const action = actions.get(packet[1])
        actions.delete(packet[1])
        if (networkDelayMs) protocol.push({ direction: 'reply', at: Date.now(), action, reply: JSON.parse(packet[2])[0] })
      }
      forward(socket, message)
    })
    const close = (target, code, reason) => {
      for (const timer of timers) clearTimeout(timer)
      target.close({ code, reason })
    }
    socket.onClose((code, reason) => close(upstream, code, reason))
    upstream.onClose((code, reason) => close(socket, code, reason))
  })
  await player.goto(`${base}player`)
  const play = async (keyboard = false) => {
    const button = player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true })
    if (keyboard) {
      await button.focus()
      await player.keyboard.press('Enter')
    } else await button.click()
  }
  const decoded = async (item) => {
    const checksum = job(item.greetingId).checksum
    await expect.poll(() => player.evaluate(target => window.audioTrace.decoded.some(value => value.checksum === target), checksum), { timeout: 15000 }).toBe(true)
  }
  await decoded(first)
  for (const id of [introId, bedId]) {
    const resource = await call(api, `animation/resources/${id}`)
    await expect.poll(() => player.evaluate(checksum => window.audioTrace.decoded.some(value => value.checksum === checksum), resource.checksum), { timeout: 15000 }).toBe(true)
  }
  const attempts = db.prepare('SELECT sum(attempts) n FROM greetingAudioJobs').get().n
  await play()
  await expect(player.getByTestId('greeting-intro')).toBeVisible()
  const leadIn = await player.evaluate(() => {
    const starts = window.audioTrace.events.filter(event => event.type === 'start')
    return starts.find(event => event.duration < 1).at - starts.find(event => event.duration > 30).at
  })
  assert.ok(leadIn >= 1950 && leadIn < 4500, `Greeting needs a two-second ambience lead-in; got ${Math.round(leadIn)} ms`)
  const backgroundElement = await player.locator('video[data-media-role="transition-background"]').elementHandle()
  await expect(player.getByTestId('greeting-overlay')).toHaveAttribute('data-greeting-id', String(first.greetingId))
  assert.equal(await backgroundElement.evaluate(video => video === document.querySelector('video[data-media-role="transition-background"]')), true)
  await expect.poll(() => backgroundElement.evaluate(video => video.videoWidth > 0 && !video.paused)).toBe(true)
  await expect(player.getByTestId('greeting-overlay')).toContainText('Karaoke: Ana')
  await expect(player.getByTestId('greeting-overlay')).toContainText('Mesa 4')
  const duplicate = await adminContext.newPage()
  await duplicate.goto(`${base}player`)
  await expect(duplicate.getByRole('heading', { name: 'Ya hay un reproductor activo' })).toBeVisible()
  assert.equal(await duplicate.evaluate(() => window.audioTrace.events.filter(event => event.type === 'start').length), 0)
  await duplicate.close()
  await player.bringToFront()
  await expect.poll(() => delivery(first)?.voiceStatus, { timeout: 12000 }).toBe('PLAYED')
  await player.screenshot({ path: path.join(data, 'greeting-karaoke.png') })
  await expect.poll(() => status(first), { timeout: 15000 }).toBe('PLAYING')
  assert.equal(db.prepare('SELECT status FROM greetings WHERE greetingId=?').get(first.greetingId).status, 'DISPLAYED')
  assert.equal(db.prepare('SELECT status FROM greetings WHERE greetingId=?').get(second.greetingId).status, 'QUEUED')
  await expect(player.getByTestId('greeting-overlay')).toHaveAttribute('data-greeting-id', String(second.greetingId), { timeout: 10000 })
  await expect(player.getByTestId('greeting-overlay')).toContainText('Pedido: Ana')
  await expect.poll(() => delivery(second)?.voiceStatus, { timeout: 12000 }).toBe('PLAYED')
  await waitPlayed(second)
  assert.equal(db.prepare('SELECT status FROM greetings WHERE greetingId=?').get(second.greetingId).status, 'DISPLAYED')
  assert.equal(db.prepare('SELECT sum(attempts) n FROM greetingAudioJobs').get().n, attempts)
  for (const item of [first, second]) {
    const row = intervention(item)
    const assets = JSON.parse(row.sequenceJSON)
    assert.deepEqual(assets.map(asset => asset.role), ['intro', 'greeting', 'bed'])
    assert.equal(assets[0].id, introId)
    assert.equal(assets[2].id, bedId)
    assert.equal(row.leaseUntil - row.requestedAt, 25000)
    assert.ok(row.finishedAt - row.requestedAt <= 25000)
    assert.equal(db.prepare('SELECT count(*) n FROM audioUsage WHERE sourceId=? AND clipId=?').get(`intervention:${row.interventionId}`, introId).n, 1)
  }
  pass('Catalog intro → greeting → each own song, explicit sing/listen identity, one public reader and no synthesis at transitions')

  // The remaining cases are independent requests. Preserve the request-time
  // greeting window instead of appending a greeting to an already-started turn.
  const room = (await call(api, 'rooms/1')).entities[1]
  await call(api, 'rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, queue: { ...room.prefs.queue, maxSongsPerParticipantRound: 1 } } }, 'PUT')

  await emit(operator, 'server/PLAYER_REQ_PAUSE', {})
  await configure(null)
  setSpeech(5.512, process.env.KES_GREETING_TEST_AUDIO)
  const delayed = await add('Este saludo debe escucharse completo con una conexión remota.')
  await decoded(delayed)
  const animation = (await emit(operator, 'server/ANIMATION_SYNC', {})).payload
  networkDelayMs = 300
  holdIdleProbe = true
  await emit(operator, 'server/ANIMATION_CONTROL', { controlVersion: animation.controlVersion, enabled: true, automation: true })
  await emit(operator, 'server/ANIMATION_SESSION', { operation: 'open' })
  try {
    await expect.poll(() => !!releaseIdleProbe).toBe(true)
    const before = await player.evaluate(() => window.audioTrace.events.length)
    await play(true)
    await expect(player.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    releaseIdleProbe()
    releaseIdleProbe = undefined
    await expect(player.getByTestId('greeting-overlay')).toHaveAttribute('data-greeting-id', String(delayed.greetingId), { timeout: 10000 })
    for (const width of [390, 1440]) {
      await player.setViewportSize({ width, height: 1000 })
      await expect.poll(() => player.locator('#player-fs-container').evaluate(element => Math.abs(element.getBoundingClientRect().width - innerWidth) < 1)).toBe(true)
      await expect.poll(() => player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await player.screenshot({ path: path.join(data, `remote-greeting-${width}.png`) })
    }
    await expect.poll(() => delivery(delayed)?.voiceStatus, { timeout: 15000 }).toBe('PLAYED')
    await waitPlayed(delayed)
    assert.equal(intervention(delayed).status, 'PLAYED')
    assert.deepEqual(JSON.parse(intervention(delayed).sequenceJSON).map(asset => asset.role), ['greeting', 'bed'])
    assert.equal(db.prepare('SELECT status FROM greetings WHERE greetingId=?').get(delayed.greetingId).status, 'DISPLAYED')
    const events = await player.evaluate(index => window.audioTrace.events.slice(index), before)
    const voices = events.filter(event => event.type === 'start' && Math.abs(event.duration * 1000 - job(delayed.greetingId).durationMs) < 100)
    assert.equal(voices.length, 1)
    const end = events.find(event => event.type === 'ended' && event.id === voices[0].id)
    assert.ok(end && end.at - voices[0].at >= voices[0].duration * 1000 - 100, 'The complete greeting must play, not just receive a start acknowledgement')
    assert.ok(intervention(delayed).finishedAt - intervention(delayed).requestedAt < 25000)
  } finally {
    fs.writeFileSync(path.join(data, 'greeting-network-trace.json'), JSON.stringify(protocol, null, 2))
    releaseIdleProbe?.()
    networkDelayMs = 0
  }
  pass('Play during an idle probe preserves the complete greeting without an intro over a 600 ms round-trip connection')

  if (process.env.KES_TTS_TEST_INSTALLATION) {
    const config = (await call(api, 'prefs/local-tts')).config
    await call(api, 'prefs/local-tts', { ...config, installationPath: installation, autoStart: false }, 'PUT')
    await expect.poll(async () => (await call(api, 'prefs/local-tts')).state, { timeout: 15000 }).toBe('ready')
  }
  await emit(operator, 'server/PLAYER_REQ_PAUSE', {})
  setSpeech(19)
  await configure(longIntroId)
  const long = await add('Este saludo se reproduce completo sin una presentación adicional.')
  await decoded(long)
  const beforeIdle = db.prepare('SELECT count(*) n FROM animationInterventions WHERE origin=?').get('GREETING').n
  let animator = (await emit(operator, 'server/ANIMATION_SYNC', {})).payload
  await emit(operator, 'server/ANIMATION_CONTROL', { controlVersion: animator.controlVersion, enabled: true, automation: true })
  await emit(operator, 'server/ANIMATION_SESSION', { operation: 'open' })
  await expect.poll(async () => (await emit(operator, 'server/ANIMATION_SYNC', {})).payload.audioUnlocked).toBe(true)
  await player.waitForTimeout(1200)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions WHERE origin=?').get('GREETING').n, beforeIdle)
  assert.equal(db.prepare('SELECT status FROM greetings WHERE greetingId=?').get(long.greetingId).status, 'QUEUED')
  animator = (await emit(operator, 'server/ANIMATION_SYNC', {})).payload
  await emit(operator, 'server/ANIMATION_CONTROL', { controlVersion: animator.controlVersion, enabled: false, automation: false })
  pass('Idle animator opportunities do not consume greetings before the operator starts their songs')
  await play()
  await expect(player.getByTestId('greeting-overlay')).toHaveAttribute('data-greeting-id', String(long.greetingId))
  assert.deepEqual(JSON.parse(intervention(long).sequenceJSON).map(asset => asset.role), ['greeting', 'bed'])
  await expect.poll(() => delivery(long)?.voiceStatus, { timeout: 23000 }).toBe('PLAYED')
  await waitPlayed(long)
  assert.ok(intervention(long).finishedAt - intervention(long).requestedAt <= 25000)
  pass('Measured duration omits an oversized intro while playing the complete nineteen-second greeting within 25 seconds')

  await emit(operator, 'server/PLAYER_REQ_PAUSE', {})
  setSpeech(8)
  await configure(introId)
  const cancelled = await add('El operador retira esta lectura.')
  await decoded(cancelled)
  await play()
  await expect.poll(() => delivery(cancelled)?.voiceStatus).toBe('PLAYING')
  await admin.goto(`${base}queue`)
  await admin.locator(`[data-queue-id="${cancelled.queueId}"]`).getByRole('button', { name: 'Retirar saludo', exact: true }).click()
  await expect(player.getByTestId('greeting-overlay')).toHaveCount(0)
  await waitPlayed(cancelled)
  assert.equal(delivery(cancelled).voiceStatus, 'INTERRUPTED')
  pass('Withdrawing an active greeting stops voice and background while its song continues')

  await emit(operator, 'server/PLAYER_REQ_PAUSE', {})
  const interrupted = await add('Esta lectura no se repite después de reiniciar.')
  await decoded(interrupted)
  await play()
  await expect.poll(() => delivery(interrupted)?.voiceStatus).toBe('PLAYING')
  const id = intervention(interrupted).interventionId
  await stop()
  await start()
  await expect(player.getByTestId('greeting-overlay')).toHaveCount(0)
  await expect.poll(() => status(interrupted), { timeout: 45000 }).toBe('PLAYED')
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions WHERE sourceEventKey=?').get(`greeting-${interrupted.queueId}`).n, 1)
  assert.equal(intervention(interrupted).interventionId, id)
  assert.notEqual(delivery(interrupted).voiceStatus, 'PLAYED')
  pass('Server restart keeps the bounded reservation fence and never re-emits an interrupted greeting')

  const trace = await player.evaluate(() => window.audioTrace.events)
  const active = new Set()
  for (const event of trace) {
    if (event.type === 'start') active.add(event.id)
    if (event.type === 'ended') active.delete(event.id)
    if (event.type === 'music' && event.volume > 0) assert.equal(active.size, 0, `Voice/background overlapped audible music: ${JSON.stringify(trace)}`)
  }
  for (const bed of trace.filter(event => event.type === 'start' && event.duration > 30)) {
    const stops = trace.filter(event => event.type === 'stop' && event.id === bed.id)
    assert.ok(stops.length && stops.every(event => event.delay <= 40000))
  }
  assert.ok(trace.some(event => event.type === 'start' && event.duration > 30))
  fs.writeFileSync(path.join(data, 'playback-trace.json'), JSON.stringify(trace, null, 2))
  await player.close()
  pass('Native audio-source trace confirms partial ambient playback, bounded stops and no voices/background at musical starts')
}
