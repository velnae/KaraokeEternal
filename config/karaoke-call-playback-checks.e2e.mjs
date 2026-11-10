import { request, expect } from 'playwright/test'
import { io } from 'socket.io-client'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { checkListeningPresentations } from './listening-presentation-checks.e2e.mjs'

export async function checkAutomaticCalls ({ page, context, browser, api, base, uiBase, data, db, call, snapshot, restart, fail }) {
  const sockets = []
  const guests = []
  let player
  const connect = async (state) => {
    const cookie = state.cookies.map(item => `${item.name}=${item.value}`).join('; ')
    const socket = io(new URL(base).origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
    sockets.push(socket)
    socket.connect()
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    return socket
  }
  const emit = async (socket, type, payload = {}) => {
    const reply = await socket.timeout(5000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 4000 } })
    assert.ok(!reply.error, reply.error)
    return reply
  }
  const proxy = async (client, clientApi) => {
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      if (incoming.headers()['content-type']) headers['content-type'] = incoming.headers()['content-type']
      try {
        const response = await clientApi.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          const responseHeaders = response.headers()
          delete responseHeaders['content-length']
          await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    }
    await client.route('https://dev-karaoke.puyu.pe/api/**', route => forward(route))
    await client.route('https://dev-karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await client.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  const join = async (name, code) => {
    const table = (await call('rooms/1/tables')).find(item => item.code === code)
    const { invitation } = await call(`rooms/1/tables/${table.tableId}/qr`)
    const client = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const clientApi = await request.newContext()
    guests.push({ client, clientApi })
    if (uiBase !== base) await proxy(client, clientApi)
    const guest = await client.newPage()
    await guest.goto(`${uiBase}join#${invitation}`)
    await guest.getByLabel('Tu nombre').fill(name)
    await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
    await expect(guest.getByRole('heading', { name: '¿Qué quieres pedir?' })).toBeVisible()
    return connect(await (uiBase === base ? client : clientApi).storageState())
  }
  const add = async (socket, songId, requestIntent, origin) => {
    await emit(socket, 'server/QUEUE_ADD', { songId, requestId: crypto.randomUUID(), requestIntent, ...(origin ? { origin } : {}) })
    return db.prepare('SELECT queueId FROM queue WHERE songId=? ORDER BY queueId DESC LIMIT 1').get(songId).queueId
  }
  const upload = async (title, kind, family, seconds, frequency) => {
    const file = path.join(data, `${title}.wav`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=44100`, '-t', String(seconds), file])
    const response = await api.post(base + 'api/animation/resources/upload', { multipart: { requestId: title, title, kind,
      metadata: JSON.stringify({ text: title === 'listening-ordinary' ? 'Seguimos con los pedidos de esta noche.' : 'La próxima canción ya está lista.', family, modes: ['mixed'], loop: kind === 'ambience' ? true : undefined }),
      file: { name: `${title}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(file) } } })
    assert.equal(response.status(), 200, await response.text())
    return response.json()
  }
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220',
      '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'call-song.mp4')])
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220',
      '-t', '12', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'seek-song.mp4')])
    db.exec(`INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture')`)
    db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
    for (const [index, title] of ['Rayando el sol', 'Yellow', 'Fallo de voz', 'Listen fixture', 'House fixture', 'Pause fixture', 'Listen one', 'Listen two', 'Listen signature', 'Listen neutral', 'Listen unavailable', 'Listen signature fallback', 'Seek source', 'Listen rebuild normal', 'Listen rebuild seek'].entries()) {
      const id = index + 1
      const filename = `song-${id}.mp4`
      fs.copyFileSync(path.join(data, id === 13 ? 'seek-song.mp4' : 'call-song.mp4'), path.join(data, filename))
      db.prepare('INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(?,1,?,?)').run(id, title, title.toLowerCase())
      db.prepare('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(?,?,1,?,?,1)').run(id, id, filename, id === 13 ? 12 : 2)
    }
    await restart()
    const room = (await call('rooms/1')).entities[1]
    await call('rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OPTIONAL' },
      queue: { ...room.prefs.queue, maxPendingPerParticipant: 10, maxSongsPerParticipantRound: 1, houseTracksBeforeParticipant: 0, approvalMode: 'AUTO' } } }, 'PUT')
    const voice = await call('prefs/greeting-voice')
    await call('prefs/greeting-voice', { ...voice.config, enabled: true }, 'PUT')
    const operator = await connect(await api.storageState())
    const state = (await emit(operator, 'server/ANIMATION_SYNC')).payload
    await emit(operator, 'server/ANIMATION_CONTROL', { controlVersion: state.controlVersion, enabled: true, automation: true, profile: 'mixed',
      volume: 0.5, ambienceEnabled: true, ambienceVolume: 0.25,
      events: { welcome: false, turn: true, closing: false, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
    await emit(operator, 'server/ANIMATION_SESSION', { operation: 'open' })
    const ordinary = await upload('ordinary-call', 'voice', 'turn', 1, 700)
    const bed = await upload('call-bed', 'ambience', 'manual', 7, 110)
    const background = await api.post(base + 'api/animation/background/upload', { multipart: { requestId: 'calls-background', file: {
      name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'call-song.mp4')) } } })
    assert.equal(background.status(), 202)
    const video = await background.json()
    await expect.poll(async () => (await call(`animation/background/videos/${video.id}`)).state).toBe('ready')
    await call('animation/background/', { videoId: video.id, dimOpacity: 0.55, revision: 0 }, 'PUT')
    await page.goto(uiBase + 'admin/settings/animator?view=calls')
    const automatic = page.getByRole('region', { name: 'Funcionamiento automático de llamados' })
    await expect(automatic.getByRole('button', { name: 'Preparar mesas', exact: true })).toBeEnabled()
    await automatic.getByRole('button', { name: 'Preparar mesas', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await snapshot()).automation.tablesReady, { timeout: 30000 }).toBe(3)
    await automatic.getByRole('switch', { name: 'Llamados automáticos' }).focus()
    await page.keyboard.press('Space')
    await expect.poll(async () => (await snapshot()).automation.controls.enabled).toBe(true)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(data, `automatic-controls-${width}.png`), fullPage: true })
    }
    const ana = await join('Ana', '01')
    const luis = await join('Luis', '03')
    await emit(operator, 'server/GREETINGS', { operation: 'prepareAudio', enabled: true })
    await emit(operator, 'server/GREETINGS', { operation: 'playback', version: 0, settings: { enabled: true, introClipId: null, ambienceEnabled: true } })
    const first = await add(ana, 1, 'SING')
    const second = await add(luis, 2, 'SING')
    await emit(luis, 'server/GREETINGS', { operation: 'attach', queueId: second, message: 'Una noche para celebrar.' })
    await expect.poll(() => db.prepare('SELECT count(*) n FROM karaokeCallRequests WHERE status=?').get('ready').n, { timeout: 30000 }).toBe(2)
    // Remove the administration application entirely: only the server prepares work.
    await page.goto('about:blank')
    fail('Fallo de voz')
    const fallback = await add(ana, 3, 'SING')
    await expect.poll(() => db.prepare('SELECT status FROM karaokeCallRequests WHERE queueId=?').get(fallback)?.status).toBe('fallback')
    await expect.poll(() => db.prepare('SELECT status FROM karaokeCallJobs WHERE id=(SELECT jobId FROM karaokeCallRequests WHERE queueId=?)').get(fallback)?.status, { timeout: 15000 }).toBe('uncertain')
    fail('')
    const listening = await add(ana, 4, 'LISTEN')
    const house = await add(operator, 5, 'LISTEN', 'HOUSE')
    assert.equal(db.prepare('SELECT count(*) n FROM karaokeCallRequests WHERE queueId IN (?,?)').get(listening, house).n, 0)
    await expect.poll(() => db.prepare('SELECT j.status FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.queueId=?').get(second)?.status, { timeout: 15000 }).toBe('ready')
    const kinds = [[ordinary.checksum, 'ordinary'], [bed.checksum, 'bed'],
      ...db.prepare(`SELECT checksum FROM karaokeCallParts WHERE kind='composition'`).all().map(row => [row.checksum, 'call']),
      ...db.prepare(`SELECT checksum FROM greetingAudioJobs WHERE status='ready'`).all().map(row => [row.checksum, 'greeting'])]
    await context.addInitScript((kinds) => {
      const labels = new Map(kinds)
      const hashes = new WeakMap()
      const active = new Map()
      window.callTrace = { starts: [], decoded: [], sceneStarts: [], videoStarts: 0 }
      const decode = AudioContext.prototype.decodeAudioData
      AudioContext.prototype.decodeAudioData = async function (bytes) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
        const buffer = await decode.call(this, bytes)
        hashes.set(buffer, hash)
        window.callTrace.decoded.push(hash)
        return buffer
      }
      const create = AudioContext.prototype.createBufferSource
      AudioContext.prototype.createBufferSource = function (...args) {
        const node = create.apply(this, args)
        const start = node.start.bind(node)
        const disconnect = node.disconnect.bind(node)
        node.disconnect = (...args) => {
          active.delete(node)
          return disconnect(...args)
        }
        node.start = (...args) => {
          const kind = labels.get(hashes.get(node.buffer)) || 'other'
          window.callTrace.starts.push({ kind, at: performance.now(), overlap: [...active.values()] })
          active.set(node, kind)
          node.addEventListener('ended', () => active.delete(node))
          return start(...args)
        }
        return node
      }
      document.addEventListener('playing', (event) => {
        if (event.target?.dataset?.mediaRole === 'transition-background') window.callTrace.videoStarts++
      }, true)
      new MutationObserver(() => {
        const scene = document.querySelector('[data-testid="transition-scene"]')
        if (scene && !scene.dataset.traced) {
          scene.dataset.traced = '1'
          window.callTrace.sceneStarts.push(performance.now())
        }
      }).observe(document, { subtree: true, childList: true })
    }, kinds)
    player = await context.newPage()
    await player.goto(uiBase + 'player')
    await expect.poll(async () => (await emit(operator, 'server/ANIMATION_SYNC')).payload.playerPresent).toBe(true)
    const firstChecksum = db.prepare('SELECT p.checksum FROM karaokeCallParts p JOIN karaokeCallRequests r ON p.id=r.resultId WHERE r.queueId=?').get(first).checksum
    await expect.poll(() => player.evaluate(hash => window.callTrace.decoded.includes(hash), firstChecksum), { timeout: 15000 }).toBe(true)
    await player.locator('body').click({ position: { x: 10, y: 10 } })
    await emit(operator, 'server/PLAYER_REQ_PLAY')
    await expect.poll(() => db.prepare('SELECT count(*) n FROM queue WHERE status=?').get('PLAYED').n, { timeout: 90000 }).toBe(5)
    const played = db.prepare('SELECT * FROM animationInterventions WHERE callJSON IS NOT NULL AND startedAt IS NOT NULL ORDER BY requestedAt').all()
    assert.equal(played.length, 3, JSON.stringify(db.prepare('SELECT status,reason,callJSON FROM animationInterventions').all()))
    assert.deepEqual(played.map(row => JSON.parse(row.callJSON).queueId).sort((a, b) => a - b), [first, second, fallback].sort((a, b) => a - b))
    assert.ok(played.every(row => row.status === 'PLAYED'))
    assert.ok(played.find(row => JSON.parse(row.callJSON).queueId === fallback).displayText.includes('próximo cantante'))
    assert.equal(db.prepare('SELECT status FROM greetings WHERE queueId=?').get(second).status, 'DISPLAYED')
    assert.equal(db.prepare('SELECT voiceStatus FROM greetingTurns WHERE turnKey=?').get(second).voiceStatus, 'PLAYED')
    assert.ok(db.prepare('SELECT count(*) n FROM animationInterventions WHERE callJSON IS NULL AND startedAt IS NOT NULL').get().n >= 1)
    const trace = await player.evaluate(() => window.callTrace)
    fs.writeFileSync(path.join(data, 'automatic-playback-trace.json'), JSON.stringify({ trace, played }, null, 2))
    assert.equal(trace.starts.filter(item => item.kind === 'call').length, 3)
    assert.ok(trace.starts.filter(item => item.kind === 'call' || item.kind === 'greeting').every(item => !item.overlap.some(kind => kind === 'call' || kind === 'greeting' || kind === 'ordinary')))
    assert.ok(trace.starts.find(item => item.kind === 'call').at - trace.sceneStarts[0] >= 1800)
    await emit(operator, 'server/PLAYER_REQ_PAUSE')
    const interrupted = await add(ana, 6, 'SING')
    await expect.poll(() => db.prepare('SELECT status FROM karaokeCallRequests WHERE queueId=?').get(interrupted)?.status, { timeout: 15000 }).toBe('ready')
    await emit(operator, 'server/PLAYER_REQ_PLAY')
    await expect(player.locator('[data-testid="transition-scene"]')).toBeVisible()
    await emit(operator, 'server/PLAYER_REQ_PAUSE')
    await player.waitForTimeout(2500)
    assert.equal(db.prepare('SELECT startedAt FROM karaokeCallRequests WHERE queueId=?').get(interrupted).startedAt, null)
    await emit(operator, 'server/PLAYER_REQ_PLAY')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(interrupted).status, { timeout: 20000 }).toBe('PLAYED')
    assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions WHERE json_extract(callJSON,?)=? AND startedAt IS NOT NULL').get('$.queueId', interrupted).n, 1)
    await page.goto(uiBase + 'admin/settings/animator?view=calls')
    await page.getByRole('switch', { name: 'Llamados automáticos' }).focus()
    await page.keyboard.press('Space')
    await expect.poll(async () => (await snapshot()).automation.controls.enabled).toBe(false)
    await expect(page.getByRole('switch', { name: 'Llamados automáticos' })).not.toBeChecked()
    await emit(operator, 'server/PLAYER_REQ_PAUSE')
    console.log('Automatic calls: setup, queue preparation without admin, singing/listening/house playback, greeting coexistence, provider fallback and pause/restart passed.')
    await checkListeningPresentations({ page, player, operator, luis, join, add, emit, db, upload, snapshot, uiBase, data, fail })
  } finally {
    fail('')
    await player?.close()
    for (const socket of sockets) socket.close()
    for (const guest of guests) {
      await guest.client.close()
      await guest.clientApi.dispose()
    }
  }
}
