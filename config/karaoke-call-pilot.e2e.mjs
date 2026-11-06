import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-call-pilot-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (instance) => {
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve))
  return instance.address().port
}
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const anonymous = await request.newContext()
const errors = []
const providerRequests = []
const source = path.join(data, 'source.wav')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=400:sample_rate=24000', '-t', '0.6', source])
const wave = fs.readFileSync(source)
let held = false
let release
const provider = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET') {
    res.end(JSON.stringify({ name: `models/${req.url.split('/').at(-1)}`, supportedGenerationMethods: ['generateContent'] }))
    return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  providerRequests.push(JSON.parse(Buffer.concat(chunks).toString()))
  if (held) await new Promise((resolve) => {
    release = resolve
    res.once('close', resolve)
  })
  if (!res.destroyed) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: wave.toString('base64') } }] } }] }))
})
const providerPort = await listen(provider)
let server, browser, page, db
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(base + 'api/' + suffix, { method, data: body })
  assert.ok([200, 202].includes(response.status()), `${response.status()}: ${await response.text()}`)
  return response.json()
}
const snapshot = () => call('rooms/1/karaoke-calls')
const ready = async (id) => {
  await expect.poll(async () => (await call(`rooms/1/karaoke-calls/jobs/${id}`)).status, { timeout: 20000 }).toBe('ready')
  return call(`rooms/1/karaoke-calls/jobs/${id}`)
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_GEMINI_API_KEY: 'fixture-only',
      KARAOKE_E2E_GEMINI_ORIGIN: `http://127.0.0.1:${providerPort}`,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/gemini-fetch.mjs')).href}` },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. Artifacts: ${data}`)
    try {
      return (await api.get(base + 'api/prefs')).status()
    } catch { return 0 }
  }, { timeout: 120000 }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exited
}
try {
  await start()
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'call-pilot-test', newPasswordConfirm: 'call-pilot-test' })
  const room = (await call('rooms/1')).entities[1]
  await call('rooms/1', { name: room.name, status: 'open', prefs: room.prefs }, 'PUT')
  await call('login', { username: 'admin', password: 'call-pilot-test', roomId: 1 })
  const voice = await call('prefs/greeting-voice')
  await call('prefs/greeting-voice', { ...voice.config, enabled: false, requestsPerMinute: 1000, requestsPerDay: 1000 }, 'PUT')
  for (const code of ['01', '03', '14']) await call('rooms/1/tables', { code })
  const tables = await call('rooms/1/tables')
  const first = tables.find(table => table.code === '01')
  const qr = await call(`rooms/1/tables/${first.tableId}/qr`)
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  const catalogCount = db.prepare('SELECT count(*) n FROM audioResources').get().n
  assert.equal((await anonymous.get(base + 'api/rooms/1/karaoke-calls')).status(), 403)

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } })
  if (httpsUi) {
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      try {
        const headers = { 'accept-encoding': 'identity' }
        for (const name of ['content-type', 'range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
        const response = await api.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const body = await response.text()
          const handshake = JSON.parse(body.slice(1))
          handshake.upgrades = []
          const responseHeaders = response.headers()
          delete responseHeaders['content-length']
          await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(uiBase + 'account?roomId=1')
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('call-pilot-test')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  const snapshotPattern = '**/api/rooms/1/karaoke-calls'
  const slowSnapshot = async (route) => {
    await new Promise(resolve => setTimeout(resolve, 2200))
    await route.fallback()
  }
  await page.route(snapshotPattern, slowSnapshot)
  await page.goto(uiBase + 'admin/settings/animator?view=calls')
  await expect(page.getByRole('heading', { name: 'Llamados de karaoke' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generar introducción', exact: true })).toBeEnabled({ timeout: 12000 })
  await page.unroute(snapshotPattern, slowSnapshot)
  await page.getByLabel('Nombre de la introducción').fill('Intro de prueba')
  await page.getByRole('button', { name: 'Generar introducción', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await snapshot()).intros.length).toBe(1)
  const intro = (await snapshot()).intros[0]
  await page.reload()
  await expect(page.getByRole('region', { name: 'Introducciones', exact: true }).getByRole('button', { name: 'Escuchar Intro de prueba', exact: true })).toBeVisible()
  assert.equal(providerRequests.length, 1)

  await page.goto(uiBase + 'admin/rooms')
  await page.getByRole('button', { name: /^Ver mesas de/ }).first().click()
  await page.getByRole('listitem', { name: 'Mesa 01', exact: true }).getByRole('button', { name: 'Voz de la mesa' }).click()
  const dialog = page.getByRole('dialog', { name: 'Voz de mesa 01' })
  await expect(dialog.getByLabel('Texto de la mesa')).toHaveValue('Desde la mesa uno,')
  await dialog.getByRole('button', { name: 'Generar voz', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Escuchar voz de mesa' })).toBeVisible({ timeout: 15000 })
  await page.screenshot({ path: path.join(data, 'table-voice-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(data, 'table-voice-mobile.png'), fullPage: true })
  await dialog.getByRole('button', { name: 'Escuchar voz de mesa' }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate((audio) => {
    window.pilotAudio = audio
  })
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.pilotAudio.paused)).toBe(true)
  assert.equal((await call(`rooms/1/tables/${first.tableId}/qr`)).invitation, qr.invitation)

  await page.goto(uiBase + 'admin/settings/animator?view=calls')
  await page.getByLabel('Introducción', { exact: true }).selectOption(intro.id)
  await page.getByLabel('Mesa', { exact: true }).selectOption(String(first.tableId))
  await page.getByLabel('Cantante', { exact: true }).fill('Ana')
  await page.getByLabel('Canción', { exact: true }).fill('Rayando el sol')
  await expect(page.getByRole('button', { name: 'Preparar prueba', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Preparar prueba', exact: true }).click()
  await expect.poll(async () => (await snapshot()).jobs.find(item => item.operation === 'hybrid')?.status, { timeout: 15000 }).toBe('ready')
  await page.getByRole('button', { name: 'Escuchar llamado híbrido', exact: true }).first().click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  await page.getByLabel('Tipo de prueba').selectOption('reference')
  await expect(page.getByRole('button', { name: 'Preparar prueba', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Preparar prueba', exact: true }).click()
  await expect.poll(async () => (await snapshot()).jobs.find(item => item.operation === 'reference')?.status, { timeout: 15000 }).toBe('ready')
  await expect(page.getByRole('button', { name: 'Escuchar frase completa', exact: true }).first()).toBeVisible()
  const count = providerRequests.length
  await call('rooms/1/karaoke-calls/previews', { requestId: crypto.randomUUID(), introId: intro.id, tableId: first.tableId, performer: 'Ana', song: 'Rayando el sol', mode: 'hybrid' }).then(item => ready(item.id))
  assert.equal(providerRequests.length, count)

  for (const [code, performer, song] of [['03', 'Luis', 'Yellow'], ['14', 'José', 'La incondicional']]) {
    const selected = tables.find(table => table.code === code)
    const text = code === '03' ? 'Desde la mesa tres,' : 'Desde la mesa catorce,'
    await call(`rooms/1/tables/${selected.tableId}/voice/generate`, { requestId: crypto.randomUUID(), text, revision: 0 }).then(item => ready(item.id))
    for (const mode of ['hybrid', 'reference']) await call('rooms/1/karaoke-calls/previews', {
      requestId: crypto.randomUUID(), introId: intro.id, tableId: selected.tableId, performer, song, mode,
    }).then(item => ready(item.id))
  }
  await expect.poll(async () => (await snapshot()).jobs.filter(item => item.operation === 'reference' && item.status === 'ready').length).toBe(3)

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.getByRole('heading', { name: 'Llamados de karaoke', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(data, `pilot-top-${width}.png`), fullPage: true })
    await page.getByRole('heading', { name: 'Probar llamado', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(data, `pilot-${width}.png`), fullPage: true })
  }
  held = true
  const cancelled = await call('rooms/1/karaoke-calls/intros', { requestId: crypto.randomUUID(), title: 'Cancelled', text: 'Otra introducción.' })
  await expect.poll(async () => (await call(`rooms/1/karaoke-calls/jobs/${cancelled.id}`)).status).toBe('generating')
  await call(`rooms/1/karaoke-calls/jobs/${cancelled.id}/cancel`, {})
  held = false
  release?.()
  await expect.poll(async () => (await call(`rooms/1/karaoke-calls/jobs/${cancelled.id}`)).status).toBe('cancelled')
  assert.equal(db.prepare('SELECT count(*) n FROM audioResources').get().n, catalogCount)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM audioUsage').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM greetings').get().n, 0)
  const beforeRestart = providerRequests.length
  await page.close()
  await stop()
  await start()
  await call('login', { username: 'admin', password: 'call-pilot-test', roomId: 1 })
  const persisted = await snapshot()
  assert.equal(persisted.intros.length, 1)
  assert.ok(persisted.jobs.some(item => item.operation === 'hybrid' && item.result))
  assert.equal(providerRequests.length, beforeRestart)
  assert.deepEqual(errors, [])
  console.log(`Karaoke call pilot ${development ? 'development StrictMode' : 'production'}${httpsUi ? ' HTTPS UI + isolated API' : ''} E2E passed. Artifacts: ${data}`)
} catch (error) {
  console.error(`Pilot failed. Artifacts: ${data}`)
  if (page && !page.isClosed()) {
    console.error(page.url(), await page.locator('body').innerText())
    await page.screenshot({ path: path.join(data, 'failure.png'), fullPage: true }).catch(() => {})
  }
  console.error(errors)
  throw error
} finally {
  held = false
  release?.()
  await browser?.close()
  await stop()
  db?.close()
  await api.dispose()
  await anonymous.dispose()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
}
