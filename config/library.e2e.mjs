import { chromium, request, expect } from 'playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-library-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
const queries = []
let resolutionDelay = 800
let failResolution = false
let searchQuotaExhausted = false
const ids = ['fixture0001', 'fixture0002', 'fixture0003']
const titles = ['Mi canción — Karaoke instrumental', 'Mi canción — Video con letras', 'Mi canción — Videoclip oficial']
const provider = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('Content-Type', 'application/json')
  assert.equal(url.searchParams.get('key'), 'test-only-youtube-key')
  if (url.pathname.endsWith('/search')) {
    const query = url.searchParams.get('q')
    queries.push(query)
    if (searchQuotaExhausted) {
      res.writeHead(429)
      res.end(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }], details: [{ reason: 'RATE_LIMIT_EXCEEDED', metadata: {
        quota_metric: 'youtube.googleapis.com/search_list', quota_unit: '1/d/{project}', quota_limit: 'defaultSearchListPerDayPerProject',
      } }] } }))
      return
    }
    if (query.includes('fallo')) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: { errors: [{ reason: 'fixtureFailure' }] } }))
      return
    }
    if (query.includes('lenta')) await new Promise(resolve => setTimeout(resolve, 1300))
    const results = query.includes('vacío') ? [] : query.includes('nueva') ? [ids[1]] : query.includes('lenta') ? [ids[0]] : ids
    res.end(JSON.stringify({ items: results.map(videoId => ({ id: { videoId } })) }))
    return
  }
  const requested = url.searchParams.get('id').split(',')
  if (requested.length === 1) {
    await new Promise(resolve => setTimeout(resolve, resolutionDelay))
    if (failResolution) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: { errors: [{ reason: 'fixtureFailure' }] } }))
      return
    }
  }
  res.end(JSON.stringify({ items: requested.map(id => ({
    id, snippet: { title: titles[ids.indexOf(id)], channelTitle: 'Canal de prueba', thumbnails: {} },
    contentDetails: { duration: 'PT3M20S' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
  })) }))
})
const providerPort = await listen(provider)
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const api = await request.newContext()
const errors = []
let browser, server, db
const pass = name => console.log(`PASS ${name}`)
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
try {
  const entry = development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']
  server = spawn(process.execPath, [...entry, '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false',
      KES_YOUTUBE_API_KEY: 'test-only-youtube-key', KARAOKE_E2E_YOUTUBE_ORIGIN: `http://127.0.0.1:${providerPort}`,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/youtube-fetch.mjs')).href}` },
  })
  let started = false
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) {
        started = true
        break
      }
    } catch { /* Wait for isolated server. */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(started, 'Isolated server started')
  await call('setup', { username: 'admin', newPassword: 'library-test-password', newPasswordConfirm: 'library-test-password', name: 'Operator' })
  const room = (await call('rooms/1')).entities[1]
  await call('rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true }, 3: { allowNew: true } }, queue: { approvalMode: 'MANUAL', maxPendingPerParticipant: 2 }, tables: { mode: 'OFF' } } }, 'PUT')
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true })
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await adminContext.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket
    window.testSockets = []
    window.WebSocket = class extends OriginalWebSocket {
      constructor (...args) {
        super(...args)
        window.testSockets.push(this)
      }
    }
  })
  const admin = await adminContext.newPage()
  admin.on('pageerror', error => errors.push(error.message))
  await admin.goto(`${base}account?roomId=1`)
  await admin.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await admin.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await admin.getByPlaceholder('contraseña', { exact: true }).fill('library-test-password')
  await admin.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await admin.getByRole('link', { name: 'Biblioteca', exact: true }).click()
  const search = admin.getByRole('searchbox', { name: 'buscar canciones', exact: true })
  await search.fill('Mi canción')
  await expect(admin.locator('article[data-source-id]')).toHaveCount(3)
  await expect(admin.getByRole('radio', { name: 'Todos', exact: true })).toBeChecked()
  await expect(admin.getByLabel('Destino de las canciones')).toHaveCount(0)
  await expect(admin.getByRole('button', { name: `Guardar ${titles[0]} en una lista`, exact: true })).toHaveCount(0)
  assert.equal(queries.at(-1), 'Mi canción')
  for (const [label, query] of [['Con letras', 'Mi canción letra lyrics'], ['Videoclip', 'Mi canción official music video'], ['Todos', 'Mi canción']]) {
    await admin.getByRole('radio', { name: label, exact: true }).focus()
    await admin.keyboard.press('Space')
    await expect.poll(() => queries.includes(query)).toBe(true)
    await expect(admin.locator('article[data-source-id]')).toHaveCount(3)
  }
  pass('Admin search modes change provider query through keyboard-accessible controls')
  await search.fill('búsqueda lenta')
  await expect.poll(() => queries.at(-1)).toBe('búsqueda lenta')
  await search.fill('búsqueda nueva')
  await expect(admin.locator('article[data-source-id]')).toHaveCount(1)
  await expect(admin.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await admin.waitForTimeout(1500)
  await expect(admin.getByRole('heading', { name: titles[0], exact: true })).toHaveCount(0)
  pass('Late search responses cannot overwrite a newer query')
  await search.fill('Mi canción')
  await expect(admin.locator('article[data-source-id]')).toHaveCount(3)
  const first = admin.locator(`[data-source-id="${ids[0]}"]`)
  await first.getByRole('button', { name: 'Agregar a la cola', exact: true }).dblclick()
  await expect(first.getByRole('button', { name: 'Agregando…', exact: true })).toBeDisabled()
  await expect(first.getByRole('link', { name: 'En la cola', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 1)
  await admin.reload()
  await admin.getByRole('searchbox').fill('Mi canción')
  await expect(first.getByRole('link', { name: 'En la cola', exact: true })).toBeVisible()
  pass('Admin double-click sends once, shows progress then confirmed queue state, and retains feedback after reload')
  const second = admin.locator(`[data-source-id="${ids[1]}"]`)
  failResolution = true
  await second.getByRole('button', { name: 'Agregar a la cola', exact: true }).click()
  await expect(second.getByText('YouTube no está disponible temporalmente').or(second.getByText('No se pudo consultar YouTube'))).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 1)
  failResolution = false
  await second.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(second.getByRole('link', { name: 'En la cola', exact: true })).toBeVisible()
  pass('Provider failure stays visible on the result and retry confirms only after acceptance')
  const third = admin.locator(`[data-source-id="${ids[2]}"]`)
  resolutionDelay = 13000
  await third.getByRole('button', { name: 'Agregar a la cola', exact: true }).click()
  await expect(third.getByRole('button', { name: 'Comprobar pedido', exact: true })).toBeVisible({ timeout: 15000 })
  await expect.poll(() => db.prepare('SELECT count(*) n FROM queue').get().n, { timeout: 5000 }).toBe(3)
  await third.getByRole('button', { name: 'Comprobar pedido', exact: true }).click()
  await expect(third.getByRole('link', { name: 'En la cola', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 3)
  resolutionDelay = 800
  pass('Uncertain acknowledgment is checked with the same request identity instead of duplicating a song')
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 1000 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `admin overflow ${width}`)
    await admin.screenshot({ path: path.join(data, `library-${width}.png`) })
  }
  await search.fill('vacío')
  await expect(admin.getByText('Sin resultados. Prueba otro título, artista o tipo de video.', { exact: true })).toBeVisible()
  await search.fill('fallo')
  await expect(admin.getByRole('button', { name: 'Reintentar búsqueda' })).toBeVisible()
  await search.fill('Mi canción')
  await expect(admin.locator('article[data-source-id]')).toHaveCount(3)
  await adminContext.setOffline(true)
  await admin.evaluate(() => window.testSockets.forEach(socket => socket.close()))
  await expect(admin.getByText('Sin conexión. La búsqueda continuará al reconectar.', { exact: true })).toBeVisible()
  await adminContext.setOffline(false)
  await expect(admin.locator('article[data-source-id]')).toHaveCount(3, { timeout: 15000 })
  assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, 3)
  pass('Reconnect restores search and confirmed feedback without resubmitting songs')
  await admin.getByRole('radio', { name: 'Archivos locales', exact: true }).check()
  await expect(admin.getByRole('heading', { name: 'No hay canciones locales' })).toBeVisible()
  pass('Admin layouts, empty/error states and local-source recovery remain usable')

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 1000 }, isMobile: true, hasTouch: true })
  const guest = await guestContext.newPage()
  guest.on('pageerror', error => errors.push(error.message))
  await guest.goto(`${base}account?roomId=1`)
  await guest.getByLabel('Tu nombre').fill('Cantante móvil')
  await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(guest).toHaveURL(`${base}library`)
  const guestSearch = guest.getByRole('searchbox', { name: 'Buscar canción o artista', exact: true })
  await guestSearch.fill('Mi canción')
  await expect(guest.locator('article[data-source-id]')).toHaveCount(3)
  await expect(guest.getByRole('radio', { name: 'Todos', exact: true })).toBeChecked()
  assert.equal(queries.filter(query => query === 'Mi canción').length, 1)
  for (const [label, suffix] of [['Con letras', 'letra lyrics'], ['Videoclip', 'official music video'], ['Karaoke', 'karaoke']]) {
    await guest.getByRole('radio', { name: label, exact: true }).check()
    await expect.poll(() => queries.includes(`Mi canción ${suffix}`)).toBe(true)
    await expect(guest.locator('article[data-source-id]')).toHaveCount(3)
  }
  const guestFirst = guest.locator(`[data-source-id="${ids[0]}"]`)
  await guestFirst.getByRole('button', { name: 'Pedir canción', exact: true }).click()
  await expect(guestFirst.getByRole('button', { name: 'Enviando…', exact: true })).toBeVisible()
  await expect(guestFirst.getByRole('link', { name: 'Por aprobar', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE status=\'PENDING_APPROVAL\'').get().n, 1)
  await guest.screenshot({ path: path.join(data, 'participant-confirmed-390.png') })
  await guest.locator(`[data-source-id="${ids[1]}"]`).getByRole('button', { name: 'Pedir canción', exact: true }).click()
  await expect(guest.locator(`[data-source-id="${ids[1]}"]`).getByRole('link', { name: 'Por aprobar', exact: true })).toBeVisible()
  const guestThird = guest.locator(`[data-source-id="${ids[2]}"]`)
  await expect(guestThird.getByRole('button', { name: 'Pedir canción', exact: true })).toBeDisabled()
  await expect(guestThird.getByText('Límite alcanzado. Revisa Mis pedidos antes de agregar otra canción.', { exact: true })).toBeVisible()
  for (const width of [320, 768]) {
    await guest.setViewportSize({ width, height: 1000 })
    assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `guest overflow ${width}`)
    await guest.screenshot({ path: path.join(data, `participant-${width}.png`), fullPage: true })
  }
  await guestFirst.getByRole('link', { name: 'Por aprobar', exact: true }).click()
  await expect(guest).toHaveURL(`${base}requests`)
  await expect(guest.getByRole('heading', { name: titles[0], exact: true })).toBeVisible()
  pass('Participant shares format filters, sending/moderation feedback, actionable limits and request navigation')
  await admin.getByRole('radio', { name: 'YouTube', exact: true }).check()
  await search.fill('Mi canción')
  await expect(first).toBeVisible()
  const beforeHouse = db.prepare('SELECT count(*) n FROM queue').get().n
  const more = first.getByRole('button', { name: `Más opciones para ${titles[0]}`, exact: true })
  await more.focus()
  await more.press('Enter')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(first.getByRole('button', { name: 'Agregar a la casa', exact: true })).toBeVisible()
  await admin.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await expect(first.getByRole('button', { name: 'Agregar a la casa', exact: true })).toHaveCount(0)
  await more.press('Enter')
  await first.getByRole('button', { name: 'Agregar a la casa', exact: true }).click()
  await expect(first.getByRole('link', { name: 'En De la casa', exact: true })).toBeVisible()
  await expect(first.getByRole('link', { name: 'En la cola', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) n FROM queue WHERE origin=\'HOUSE\'').get().n, 1)
  await first.getByRole('button', { name: `Guardar ${titles[0]} en una lista`, exact: true }).click()
  const saveDialog = admin.getByRole('dialog', { name: 'Guardar en una lista', exact: true })
  await saveDialog.getByLabel('Nombre de la nueva lista', { exact: true }).fill('YouTube diario')
  await saveDialog.getByRole('button', { name: 'Guardar canción', exact: true }).click()
  await expect(saveDialog.getByText('Guardada en «YouTube diario»', { exact: true })).toBeVisible()
  await saveDialog.getByRole('button', { name: 'Listo', exact: true }).click()
  await first.getByRole('button', { name: `Guardar ${titles[0]} en una lista`, exact: true }).click()
  await expect(saveDialog.getByText('Esta canción ya está en la lista.', { exact: true })).toBeVisible()
  await expect(saveDialog.getByRole('button', { name: 'Guardar canción', exact: true })).toBeDisabled()
  await expect(saveDialog.getByLabel('Nombre de la nueva lista', { exact: true })).toHaveCount(0)
  const savedListId = db.prepare('SELECT playlistId FROM musicPlaylists').get().playlistId
  await saveDialog.getByLabel('Lista de destino').selectOption('new')
  await expect(saveDialog.getByLabel('Nombre de la nueva lista', { exact: true })).toBeVisible()
  await saveDialog.getByLabel('Lista de destino').selectOption(String(savedListId))
  await expect(saveDialog.getByLabel('Nombre de la nueva lista', { exact: true })).toHaveCount(0)
  assert.equal(db.prepare('SELECT count(*) n FROM musicPlaylistItems').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM queue').get().n, beforeHouse + 1)
  await admin.keyboard.press('Escape')
  await expect(first.getByRole('button', { name: `Guardar ${titles[0]} en una lista`, exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1000 })
    await first.scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await first.screenshot({ path: path.join(data, `library-options-${width}.png`) })
  }
  await more.focus()
  await more.press('Escape')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  assert.equal((await guestContext.request.get(`${base}api/rooms/1/playlists`)).status(), 403)
  assert.equal((await guestContext.request.post(`${base}api/rooms/1/playlists`, { data: { name: 'Forbidden' } })).status(), 403)
  for (const [method, suffix, body] of [
    ['PUT', '/playback', { playlistId: savedListId, enabled: true, repeat: true }],
    ['POST', `/${savedListId}/items`, { source: 'YOUTUBE', sourceId: ids[0] }],
    ['PUT', `/${savedListId}/order`, { order: [] }],
    ['DELETE', `/${savedListId}`, undefined],
  ]) assert.equal((await guestContext.request.fetch(`${base}api/rooms/1/playlists${suffix}`, { method, data: body })).status(), 403)
  pass('Admin can queue YouTube as house music and save a reusable deduplicated playlist; participants cannot administer lists')

  searchQuotaExhausted = true
  const searchesBeforeQuota = queries.length
  await search.fill('búsqueda bloqueada')
  await expect(admin.getByText(/Se agotó el límite diario de búsquedas de YouTube/)).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Reintentar búsqueda' })).toHaveCount(0)
  await admin.screenshot({ path: path.join(data, 'quota-admin-1440.png') })
  await guest.goto(`${base}library`)
  await guest.setViewportSize({ width: 390, height: 1000 })
  await guestSearch.fill('otra búsqueda bloqueada')
  await expect(guest.getByText(/Se agotó el límite diario de búsquedas de YouTube/)).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0)
  assert.equal(queries.length, searchesBeforeQuota + 1, 'quota cooldown avoids another rejected provider call')
  await guest.screenshot({ path: path.join(data, 'quota-mobile-390.png') })
  await search.fill('Mi canción')
  await expect(admin.locator('article[data-source-id]')).toHaveCount(3)
  assert.equal(queries.length, searchesBeforeQuota + 1, 'cached searches remain usable during exhaustion')
  pass('Real-shaped daily quota errors are actionable in admin/mobile; cache and cooldown avoid repeated API calls')

  guest.on('dialog', dialog => dialog.accept())
  await guest.goto(`${base}requests`)
  await guest.getByRole('button', { name: 'Cancelar pedido', exact: true }).first().click()
  await expect(guest.getByText('Pedido cancelado', { exact: true })).toBeVisible()
  await guest.goto(`${base}library`)
  await guest.getByRole('radio', { name: 'Karaoke', exact: true }).check()
  await guestSearch.fill(`https://youtu.be/${ids[2]}`)
  await expect(guest.locator('article[data-source-id]')).toHaveCount(1)
  await guest.locator(`[data-source-id="${ids[2]}"]`).getByRole('button', { name: 'Pedir canción', exact: true }).click()
  await expect(guest.locator(`[data-source-id="${ids[2]}"]`).getByRole('link', { name: 'Por aprobar', exact: true })).toBeVisible()
  await guest.screenshot({ path: path.join(data, 'link-mobile-390.png') })
  await admin.getByRole('radio', { name: 'Karaoke', exact: true }).check()
  await search.fill(`https://www.youtube.com/watch?v=${ids[2]}`)
  await expect(admin.locator('article[data-source-id]')).toHaveCount(1)
  await expect(admin.getByRole('heading', { name: titles[2], exact: true })).toBeVisible()
  assert.equal(queries.length, searchesBeforeQuota + 1, 'video links never consume search.list quota')
  pass('Pasted YouTube links work in both interfaces and permit a mobile song request while text search quota is exhausted')
  assert.deepEqual(errors, [])
  console.log(`Evidence: ${data}; all YouTube API responses simulated`)
} catch (error) {
  console.error(`Evidence retained: ${data}`, errors)
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(page.url(), await page.locator('body').innerText().catch(() => 'unavailable'))
  }
  throw error
} finally {
  await browser?.close()
  if (server && server.exitCode === null && server.signalCode === null) {
    const ended = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await ended
  }
  db?.close()
  await api.dispose()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
}
