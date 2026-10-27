import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-phase2-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
function wave (seconds) {
  const count = Math.round(24000 * seconds)
  const buffer = Buffer.alloc(44 + count * 2)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(48000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(count * 2, 40)
  for (let index = 0; index < count; index++) buffer.writeInt16LE(Math.round(5000 * Math.sin(index * 2 * Math.PI * 330 / 24000)), 44 + index * 2)
  return buffer
}
const providerCalls = []
let providerFails = false
let providerDelay = 0
const provider = createServer(async (req, res) => {
  assert.equal(req.headers['xi-api-key'], 'test-only-secret')
  if (req.url === '/v1/models') {
    res.end(JSON.stringify([{ model_id: 'eleven_v4' }]))
    return
  }
  if (req.url === '/v1/voices') {
    res.end(JSON.stringify({ voices: [{ voice_id: 'testvoice', name: 'Voz de prueba E2E' }] }))
    return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  if (providerDelay) await new Promise(resolve => setTimeout(resolve, providerDelay))
  providerCalls.push({ url: req.url, body })
  if (providerFails) {
    res.writeHead(500)
    res.end('unavailable')
    return
  }
  res.setHeader('request-id', `fixture-${providerCalls.length}`)
  res.setHeader('Content-Type', 'audio/wav')
  res.end(wave(body.duration_seconds ?? 1.2))
})
const providerPort = await listen(provider)
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const api = await request.newContext()
let server, browser, socket, db
const errors = []
const pass = name => console.log(`PASS ${name}`)
const start = async () => {
  const entry = development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']
  server = spawn(process.execPath, [...entry, '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false',
      KES_ELEVENLABS_API_KEY: 'test-only-secret', KES_ELEVENLABS_BASE_URL: `http://127.0.0.1:${providerPort}`, KES_ELEVENLABS_VOICE_ID: '',
      KES_ELEVENLABS_MODEL: 'eleven_v4', KES_ELEVENLABS_CHARACTER_LIMIT: '10000', KES_ELEVENLABS_EFFECT_SECONDS_LIMIT: '60' },
  })
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for isolated server. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Server unavailable')
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const ended = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await ended
}
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const reply = await socket.timeout(4000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 3000 } })
  assert.ok(!reply.error, reply.error)
  return reply
}
const history = () => db.prepare('SELECT * FROM animationInterventions ORDER BY rowid DESC').all()
const countFamily = family => history().filter(row => row.family === family && row.startedAt).length

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(data, 'song.mp4')])
  await start()
  await call('setup', { username: 'admin', newPassword: 'phase2-test-password', newPasswordConfirm: 'phase2-test-password', name: 'Operator' })
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  db.exec('INSERT INTO artists(artistId,name,nameNorm) VALUES(1,\'Artist\',\'artist\'); INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,\'Test song\',\'test song\');')
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',6,1)')
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'phase2-test-password', roomId: 1 })
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', extraHeaders: { cookie }, transports: ['websocket'], autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  await context.addInitScript(() => {
    window.animationStarts = []
    const active = new Set()
    const start = AudioBufferSourceNode.prototype.start
    const disconnect = AudioNode.prototype.disconnect
    AudioNode.prototype.disconnect = function (...args) {
      active.delete(this)
      return disconnect.apply(this, args)
    }
    AudioBufferSourceNode.prototype.start = function (...args) {
      const video = document.querySelector('video')
      window.animationStarts.push({ duration: this.buffer.duration, overlap: [...active].some(source => source.context.state === 'running'), music: !!video && !video.paused && !video.ended })
      active.add(this)
      this.addEventListener('ended', () => active.delete(this))
      return start.apply(this, args)
    }
  })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const admin = await context.newPage()
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('phase2-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(admin.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await admin.goto(`${base}admin/settings/animator?view=audio`)
  const production = admin.getByRole('region', { name: 'Biblioteca de audios' })
  const animatorNav = admin.getByRole('navigation', { name: 'Ajustes del animador' })
  const generate = async (title, text, kind = 'voice', duration = '2') => {
    const labels = { voice: 'Voz del animador', effect: 'Efectos de apoyo', ambience: 'Ambiente de pausa' }
    await production.getByRole('navigation', { name: 'Tipos de audio' }).getByRole('link', { name: new RegExp(`^${labels[kind]}`) }).click()
    await production.getByRole('button', { name: 'Generar audio', exact: true }).click()
    const form = admin.getByRole('dialog', { name: 'Generar audio', exact: true })
    await form.getByLabel('Nombre', { exact: true }).fill(title)
    await form.getByLabel(kind === 'voice' ? 'Texto del audio' : 'Descripción del sonido', { exact: true }).fill(text)
    if (kind === 'voice') await expect(form.getByLabel('Voz', { exact: true })).toHaveValue('testvoice')
    else await form.getByLabel('Duración (segundos)', { exact: true }).fill(duration)
    if (kind === 'ambience') await form.getByLabel('Apto para repetirse en bucle').check()
    if (['Presentación 1', 'Aplauso breve', 'Ambiente de pausa'].includes(title)) {
      for (const width of [390, 1440]) {
        await admin.setViewportSize({ width, height: 1100 })
        assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        await form.screenshot({ path: path.join(data, `form-${kind}-${width}.png`) })
      }
    }
    await form.getByRole('button', { name: 'Generar audio', exact: true }).click()
    await expect(form).toBeHidden()
  }
  await expect(production.getByRole('button', { name: /publicar|aprobar/i })).toHaveCount(0)
  await expect(production.getByText(/tarifa|USD estimados|consumo/i)).toHaveCount(0)
  providerDelay = 1500
  await generate('Presentación 1', 'La siguiente canción ya está lista. Sigamos disfrutando juntos.')
  await admin.getByRole('navigation', { name: 'Secciones de administración' }).getByRole('link', { name: 'Cola', exact: true }).click()
  await expect(admin.locator('#animator')).toHaveCount(0)
  await admin.goBack()
  await expect(production.getByRole('row', { name: 'Presentación 1', exact: true })).toContainText('Disponible', { timeout: 20000 })
  providerDelay = 0
  assert.equal(providerCalls.length, 1)
  await admin.reload()
  await expect(production.getByRole('row', { name: 'Presentación 1', exact: true })).toContainText('Disponible')
  pass('Generation becomes available automatically and survives navigation/reload without review or publication')
  const firstJob = (await call('animation/production')).jobs[0]
  const reused = await call('animation/production/jobs', { inputs: [firstJob.config] })
  assert.equal(reused[0].jobId, firstJob.jobId)
  assert.equal(providerCalls.length, 1)
  await call('animation/production/jobs', { inputs: [2, 3].map(index => ({ ...firstJob.config, title: `Presentación ${index}`, text: `Presentación variante ${index} para continuar con la música.` })) })
  await expect.poll(() => db.prepare('SELECT count(*) n FROM catalogGenerationJobs WHERE status=\'published\'').get().n, { timeout: 20000 }).toBe(3)
  assert.equal(providerCalls.length, 3)
  assert.ok(providerCalls.every(call => call.body.model_id === 'eleven_v4'))
  assert.equal(history().length, 0)
  pass('Provider adapter uses speech model; duplicate requests reuse assets without automatic public playback')

  const extra = ['welcome', 'closing', 'invitation', 'celebration', 'goodbye'].flatMap(family => Array.from({ length: 3 }, (_, index) => ({
    title: `${family} ${index + 1}`, text: `${family} variante ${index + 1} para compartir en esta sala.`, kind: 'voice', family, style: 'cheerful', voiceId: 'testvoice',
  })))
  await call('animation/production/jobs', { inputs: extra.slice(0, 9) })
  await call('animation/production/jobs', { inputs: extra.slice(9) })
  await expect.poll(() => db.prepare('SELECT count(*) n FROM catalogGenerationJobs WHERE status=\'published\'').get().n, { timeout: 20000 }).toBe(18)
  await production.getByRole('button', { name: 'Escuchar Presentación 1', exact: true }).focus()
  await production.getByRole('button', { name: 'Escuchar Presentación 1', exact: true }).press('Enter')
  await expect(production.locator('audio')).toHaveCount(1)
  await expect.poll(() => production.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  assert.equal(history().length, 0)
  await production.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  pass('Direct keyboard listening needs no monitoring checkbox and creates no public playback history')

  for (const [kind, title, text, duration] of [['effect', 'Aplauso breve', 'A gentle short applause.', '2'], ['ambience', 'Ambiente de pausa', 'Quiet restaurant room tone, no voices.', '3']]) {
    await generate(title, text, kind, duration)
    await expect(production.getByRole('row', { name: title, exact: true })).toContainText('Disponible', { timeout: 20000 })
  }
  assert.equal(providerCalls.filter(call => call.url.includes('sound-generation')).length, 2)
  assert.ok(providerCalls.some(call => call.body.loop === true))
  const beforeUpload = providerCalls.length
  await production.getByRole('navigation', { name: 'Tipos de audio' }).getByRole('link', { name: /^Voz del animador/ }).click()
  await production.getByRole('button', { name: 'Subir audio', exact: true }).click()
  const upload = admin.getByRole('dialog', { name: 'Subir audio', exact: true })
  await upload.getByLabel('Nombre', { exact: true }).fill('Audio subido')
  await upload.getByLabel('Archivo de audio', { exact: true }).setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: wave(1) })
  await upload.getByLabel('Uso del audio', { exact: true }).selectOption('manual')
  await upload.getByRole('button', { name: 'Subir audio', exact: true }).click()
  await expect(upload).toBeHidden()
  await expect(production.getByRole('row', { name: 'Audio subido', exact: true })).toContainText('Disponible')
  assert.equal(providerCalls.length, beforeUpload)
  const uploadedId = new URL(admin.url()).searchParams.get('resourceId')
  assert.ok(uploadedId.startsWith('uploaded-'))
  await production.getByRole('button', { name: 'Detalles de Audio subido', exact: true }).click()
  const detail = admin.getByRole('dialog', { name: 'Datos del audio', exact: true })
  await detail.getByLabel('Nombre', { exact: true }).fill('Voz importada')
  await detail.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(production.getByRole('row', { name: 'Voz importada', exact: true })).toBeVisible()
  await production.getByRole('button', { name: 'Detalles de Voz importada', exact: true }).click()
  await detail.getByRole('button', { name: 'Desactivar', exact: true }).click()
  await expect(production.getByRole('row', { name: 'Voz importada', exact: true })).toContainText('Desactivado')
  await production.getByRole('button', { name: 'Escuchar Voz importada', exact: true }).click()
  await expect.poll(() => production.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await production.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  const downloaded = await api.get(`${base}api/animation/resources/${uploadedId}/audio?download=true`)
  assert.equal(downloaded.status(), 200)
  assert.match(downloaded.headers()['content-disposition'], /attachment/)
  await production.getByRole('button', { name: 'Detalles de Voz importada', exact: true }).click()
  await detail.getByRole('button', { name: 'Archivar', exact: true }).click()
  await expect(production.getByRole('row', { name: 'Voz importada', exact: true })).toContainText('Archivado')
  pass('File upload becomes available without provider calls; metadata edit, inactive preview, download and archive work')

  await production.getByRole('navigation', { name: 'Tipos de audio' }).getByRole('link', { name: /^Voz del animador/ }).click()
  await production.getByLabel('Buscar audio', { exact: true }).fill('Presentación 1')
  await production.getByRole('button', { name: 'Detalles de Presentación 1', exact: true }).click()
  await detail.getByRole('button', { name: 'Crear otra versión', exact: true }).click()
  const version = admin.getByRole('dialog', { name: 'Crear otra versión', exact: true })
  await version.getByLabel('Nombre', { exact: true }).fill('Presentación alternativa')
  await version.getByLabel('Texto del audio', { exact: true }).fill('Otra presentación para acompañar la música.')
  await version.getByRole('button', { name: 'Generar audio', exact: true }).click()
  await expect(version).toBeHidden()
  await expect(production.getByRole('row', { name: 'Presentación alternativa', exact: true })).toContainText('Disponible', { timeout: 20000 })
  const alternative = await call(`animation/resources/${new URL(admin.url()).searchParams.get('resourceId')}`)
  assert.equal(alternative.metadata.parentId, `generated-${firstJob.jobId}`)
  assert.equal((await call(`animation/resources/generated-${firstJob.jobId}`)).title, 'Presentación 1')
  pass('Another generated version preserves the original resource and links its provenance')
  const paidCalls = providerCalls.length
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1200 })
    await admin.locator('main').evaluate(element => element.scrollTo({ top: 0 }))
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `production-${width}.png`) })
  }
  await animatorNav.getByRole('link', { name: 'Control', exact: true }).click()
  pass('Typed generation forms create effects and looping ambience in their own inventory tabs')

  await admin.getByLabel('Activado', { exact: true }).click()
  await expect(admin.getByLabel('Activado', { exact: true })).toBeChecked()
  const player = await context.newPage()
  await player.goto(`${base}player`)
  await player.getByRole('button', { name: 'Habilitar audio del animador' }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.audioUnlocked).toBe(true)
  await admin.getByLabel('Funcionamiento', { exact: true }).selectOption('automatic')
  await admin.getByRole('button', { name: 'Iniciar jornada', exact: true }).click()
  await expect.poll(() => countFamily('welcome'), { timeout: 12000 }).toBe(1)
  await expect.poll(() => history()[0]?.status).toBe('PLAYED')
  await admin.reload()
  const sessionId = (await emit('server/ANIMATION_SYNC')).payload.session.sessionId
  await admin.getByRole('navigation', { name: 'Secciones de administración' }).getByRole('link', { name: 'Usuarios', exact: true }).click()
  await admin.goBack()
  assert.equal((await emit('server/ANIMATION_SYNC')).payload.session.sessionId, sessionId)
  assert.equal(countFamily('welcome'), 1)
  pass('Explicit session opening emits one welcome; refresh does not open a new session')

  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => countFamily('turn')).toBe(1)
  await expect.poll(() => db.prepare('SELECT queueId FROM queue WHERE status=\'PLAYING\'').get()?.queueId).toBe(1)
  await expect.poll(() => countFamily('turn'), { timeout: 12000 }).toBe(2)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, 'APPROVED')
  await expect.poll(() => countFamily('closing'), { timeout: 15000 }).toBe(1)
  await expect.poll(() => history()[0]?.status).toBe('PLAYED')
  assert.equal(new Set(history().filter(row => row.family === 'turn').map(row => row.displayText)).size, 2)
  assert.equal(providerCalls.length, paidCalls)
  pass('Automatic first/next-turn introductions and natural close use varied local assets, without generation calls')

  await admin.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await admin.getByLabel('Sonido de pausa', { exact: true }).click()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.getByRole('dialog', { name: 'Ajustes del animador', exact: true }).screenshot({ path: path.join(data, `settings-${width}.png`) })
  }
  await admin.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience !== null, { timeout: 12000 }).toBe(true)
  await expect.poll(() => player.evaluate(() => window.animationStarts.filter(start => start.duration > 2.8).length), { timeout: 12000 }).toBeGreaterThanOrEqual(2)
  await admin.getByRole('button', { name: 'Confirmar celebración', exact: true }).click()
  await expect.poll(() => countFamily('celebration'), { timeout: 15000 }).toBe(1)
  await expect.poll(() => history()[0]?.status, { timeout: 10000 }).toBe('PLAYED')
  const celebration = history().find(row => row.family === 'celebration')
  assert.equal(JSON.parse(celebration.sequenceJSON).length, 2)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience !== null, { timeout: 10000 }).toBe(true)
  await admin.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await admin.getByLabel('Sonido de pausa', { exact: true }).click()
  await expect(admin.getByLabel('Sonido de pausa', { exact: true })).not.toBeChecked()
  await admin.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience === null).toBe(true)
  await admin.getByRole('button', { name: 'Ajustes', exact: true }).click()
  await admin.getByLabel('Sonido de pausa', { exact: true }).click()
  await expect(admin.getByLabel('Sonido de pausa', { exact: true })).toBeChecked()
  await admin.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience !== null, { timeout: 10000 }).toBe(true)
  pass('Finite ambience renews, yields to celebration plus applause, and responds to its actual enable control')

  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await expect.poll(() => db.prepare('SELECT queueId FROM queue WHERE status=\'PLAYING\'').get()?.queueId, { timeout: 10000 }).toBe(3)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience === null).toBe(true)
  const beforeSkip = history().length
  await emit('server/PLAYER_REQ_NEXT')
  await player.waitForTimeout(300)
  assert.equal(history().length, beforeSkip)
  assert.ok((await player.evaluate(() => window.animationStarts)).every(start => !start.overlap && !start.music))
  pass('New music preempts ambience and skip does not create a false natural-end announcement')

  await admin.getByRole('button', { name: 'Cerrar jornada', exact: true }).click()
  await expect.poll(() => countFamily('goodbye'), { timeout: 15000 }).toBe(1)
  await expect.poll(() => db.prepare('SELECT count(*) n FROM animationSessions WHERE status=\'CLOSED\'').get().n).toBe(1)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.ambience === null).toBe(true)
  pass('Closing emits a single farewell and finishes the operational session without clearing history')

  providerFails = true
  await animatorNav.getByRole('link', { name: 'Audios', exact: true }).click()
  await generate('Provider failure', 'Una frase nueva para probar el fallo.')
  await expect.poll(() => db.prepare('SELECT status FROM catalogGenerationJobs ORDER BY rowid DESC LIMIT 1').get().status).toBe('uncertain')
  await expect(production.getByRole('row', { name: 'Provider failure', exact: true })).toContainText('Sin confirmación')
  await expect(production.getByRole('row', { name: 'Provider failure', exact: true })).toContainText('HTTP 500')
  const callsAfterFailure = providerCalls.length
  const failedId = db.prepare('SELECT jobId FROM catalogGenerationJobs ORDER BY rowid DESC LIMIT 1').get().jobId
  const retryResponse = admin.waitForResponse(response => response.url().endsWith('/api/animation/production/jobs') && response.request().method() === 'POST')
  await generate('Provider failure', 'Una frase nueva para probar el fallo.')
  const repeated = await (await retryResponse).json()
  assert.equal(repeated[0].jobId, failedId)
  assert.equal(providerCalls.length, callsAfterFailure)
  await expect(production.getByRole('row', { name: 'Provider failure', exact: true })).toContainText('Sin confirmación')
  await admin.setViewportSize({ width: 390, height: 1100 })
  await production.getByRole('row', { name: 'Provider failure', exact: true }).scrollIntoViewIfNeeded()
  await admin.screenshot({ path: path.join(data, 'generation-error-390.png') })
  await admin.setViewportSize({ width: 1440, height: 1200 })
  await animatorNav.getByRole('link', { name: 'Control', exact: true }).click()
  pass('Single generation failure and cached retries are visible next to the action without extra provider calls')
  await emit('server/QUEUE_ADD', { songId: 1, requestId: crypto.randomUUID() })
  await expect.poll(() => player.locator('video').evaluate(video => !video.paused).catch(() => false)).toBe(true)
  pass('Provider failure is explicit and does not stop music or the existing catalog')

  const catalog = await call('animation/catalog')
  const manualClip = catalog.find(clip => clip.family === 'turn')
  const insertBudget = db.prepare(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,startedAt,finishedAt)
    VALUES(?,1,?,1,?,?,?,10000,'PLAYED',?,?,?,?)`)
  for (let index = 0; index < 12; index++) {
    const now = Date.now()
    insertBudget.run(`budget-fixture-${index}`, `budget-fixture-${index}`, manualClip.id, manualClip.checksum, 'Fixture de presupuesto', now, now, now, now)
  }
  await emit('server/ANIMATION_REQUEST', { clipId: manualClip.id, requestId: crypto.randomUUID() })
  const waiting = history()[0].interventionId
  await expect.poll(() => db.prepare('SELECT status FROM animationInterventions WHERE interventionId=?').get(waiting).status).toBe('PENDING')
  await player.waitForTimeout(500)
  assert.equal(db.prepare('SELECT startedAt FROM animationInterventions WHERE interventionId=?').get(waiting).startedAt, null)
  db.prepare('UPDATE animationInterventions SET startedAt=? WHERE interventionId LIKE \'budget-fixture-%\'').run(Date.now() - 601000)
  await expect.poll(() => db.prepare('SELECT status FROM animationInterventions WHERE interventionId=?').get(waiting).status, { timeout: 20000 }).toBe('PLAYED')
  pass('A valid request waits for the rolling voice budget and resumes after history ages, without manual refresh')

  const beforeRestart = history().length
  const productionsBeforeRestart = providerCalls.length
  await stop()
  await start()
  await expect.poll(() => socket.connected, { timeout: 10000 }).toBe(true)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent, { timeout: 10000 }).toBe(true)
  assert.equal(history().length, beforeRestart)
  assert.equal(providerCalls.length, productionsBeforeRestart)
  assert.equal(db.prepare('SELECT count(*) n FROM animationSessions WHERE status=\'CLOSED\'').get().n, 1)
  pass('Restart preserves sessions, catalog and history without replaying announcements or regenerating paid jobs')
  await call('rooms', { name: 'Private inventory', status: 'open', prefs: {} })
  const resource = db.prepare('SELECT * FROM audioResources WHERE id=?').get(`generated-${firstJob.jobId}`)
  const copy = db.prepare('INSERT INTO audioResources(id,roomId,kind,title,state,preparation,metadataJSON,filename,mime,checksum,durationMs,size,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  copy.run('private-resource', 2, 'voice', 'Private voice', 'active', 'ready', resource.metadataJSON, resource.filename, resource.mime, resource.checksum, resource.durationMs, resource.size, Date.now(), Date.now())
  assert.equal((await api.get(`${base}api/animation/resources/private-resource`)).status(), 404)
  assert.equal((await api.get(`${base}api/animation/resources/private-resource/audio`)).status(), 404)
  assert.equal((await api.patch(`${base}api/animation/resources/private-resource`, { data: { title: 'Leaked' } })).status(), 422)
  const anonymous = await request.newContext()
  assert.equal((await anonymous.get(`${base}api/animation/resources`)).status(), 403)
  assert.equal((await anonymous.post(`${base}api/animation/resources/upload`, { data: {} })).status(), 403)
  await anonymous.dispose()
  const range = await api.get(`${base}api/animation/resources/${uploadedId}/audio`, { headers: { Range: 'bytes=0-99' } })
  assert.equal(range.status(), 206)
  assert.equal((await range.body()).length, 100)
  pass('Inventory APIs isolate rooms, deny anonymous access and serve preview/download byte ranges')

  const inventoryMetadata = JSON.stringify({ ...JSON.parse(resource.metadataJSON), family: 'manual', automatic: false, origin: 'uploaded', providerId: undefined })
  for (let index = 0; index < 205; index++) copy.run(`inventory-${index}`, 1, 'voice', `Inventario ${String(index).padStart(3, '0')}`, 'active', 'ready', inventoryMetadata, resource.filename, resource.mime, resource.checksum, resource.durationMs, resource.size, Date.now(), Date.now())
  const inventoryPage = await call('animation/resources?kind=voice&search=Inventario&page=11&sort=title&direction=asc')
  assert.equal(inventoryPage.total, 205)
  assert.equal(inventoryPage.items.length, 5)
  assert.equal(inventoryPage.items[0].title, 'Inventario 200')
  assert.ok((await call('animation/preparation')).length <= 24)
  await animatorNav.getByRole('link', { name: 'Audios', exact: true }).click()
  await production.getByLabel('Buscar audio', { exact: true }).fill('')
  await production.getByLabel('Buscar audio', { exact: true }).pressSequentially('Inventario', { delay: 10 })
  await expect(production.getByLabel('Buscar audio', { exact: true })).toBeFocused()
  await expect(production.getByText('205 audios · Página 1 de 11', { exact: true })).toBeVisible()
  await production.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(production.getByText('205 audios · Página 2 de 11', { exact: true })).toBeVisible()
  await admin.reload()
  await expect(production.getByText('205 audios · Página 2 de 11', { exact: true })).toBeVisible()
  const callsBeforeInventoryRestart = providerCalls.length
  await stop()
  await start()
  await expect.poll(async () => (await call('animation/resources?kind=voice&search=Inventario')).total, { timeout: 10000 }).toBe(205)
  assert.equal(providerCalls.length, callsBeforeInventoryRestart)
  assert.equal((await call(`animation/resources/${uploadedId}`)).state, 'archived')
  pass('Inventory exceeds old active/total/job limits with paginated search while player preparation stays bounded')
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 1100 })
    await admin.locator('main').evaluate(element => element.scrollTo({ top: 0 }))
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `inventory-${width}.png`) })
  }
  await animatorNav.getByRole('link', { name: 'Control', exact: true }).click()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1200 })
    await admin.locator('main').evaluate(element => element.scrollTo({ top: 0 }))
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(data, `operation-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  console.log(`Evidence: ${data}; provider calls: ${providerCalls.length} (all simulated)`)
} catch (error) {
  console.error(`Evidence retained: ${data}`, errors)
  if (db) console.error('History:', history(), 'Jobs:', db.prepare('SELECT status,error FROM catalogGenerationJobs').all())
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error(page.url(), await page.locator('body').innerText().catch(() => 'unavailable'))
  throw error
} finally {
  socket?.disconnect()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
}
