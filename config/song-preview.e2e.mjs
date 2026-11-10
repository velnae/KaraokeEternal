import { chromium, request, expect } from 'playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubePreviewMock } from './fixtures/youtube-preview.mjs'
import { checkParticipantStatuses } from './participant-status-checks.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-preview-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
const ids = ['fixture0001', 'fixture0002', 'fixture0003']
const nonKaraokeId = 'fixture0004'
const titles = ['Canción Karaoke', 'Karaokanta - Canción', 'Canción KARAOKE con voz guía']
let searchCalls = 0
let lastSearchQuery = ''
const provider = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname.endsWith('/search')) {
    searchCalls++
    lastSearchQuery = url.searchParams.get('q')
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ items: url.pathname.endsWith('/search')
    ? [...ids, nonKaraokeId].map(videoId => ({ id: { videoId } }))
    : url.searchParams.get('id').split(',').map(id => ({
        id, snippet: { title: titles[ids.indexOf(id)] ?? `Canción ${id} video oficial`, channelTitle: 'Canal de prueba', categoryId: '10', liveBroadcastContent: 'none', thumbnails: {} },
        contentDetails: { duration: 'PT3M' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
      })) }))
})
const providerPort = await listen(provider)
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const api = await request.newContext()
let server, browser, db
const errors = []
const pass = message => console.log(`PASS ${message}`)
const call = async (url, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${url}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const isolateHttps = async (context) => {
  // Real tunnel HTML/assets, isolated backend for every read/write and socket.
  await context.route(/\/(api|socket\.io)\//, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: new URL(url.pathname.slice(1) + url.search, base).href })
    let body = await response.text()
    if (url.pathname.includes('/socket.io/') && body.startsWith('0{')) body = '0' + JSON.stringify({ ...JSON.parse(body.slice(1)), upgrades: [] })
    await route.fulfill({ response, body })
  })
  await context.routeWebSocket(/\/socket\.io\//, ws => ws.close())
}

try {
  // Source backend with production assets avoids rebuilding unrelated server code.
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false',
      KES_YOUTUBE_API_KEY: 'test-only-youtube-key', KARAOKE_E2E_YOUTUBE_ORIGIN: `http://127.0.0.1:${providerPort}`,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/youtube-fetch.mjs')).href}` },
  })
  await expect.poll(async () => {
    try {
      return (await fetch(`${base}api/prefs`)).ok
    } catch { return false }
  }, { timeout: 30000 }).toBe(true)
  await call('setup', { username: 'admin', newPassword: 'preview-only-password', newPasswordConfirm: 'preview-only-password', name: 'Operator' })
  const room = (await call('rooms/1')).entities[1]
  await call('rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true }, 3: { allowNew: true } }, tables: { mode: 'OFF' }, queue: { approvalMode: 'MANUAL', maxPendingPerParticipant: 2 } } }, 'PUT')
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  const count = () => db.prepare('SELECT count(*) n FROM queue').get().n
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: ['--mute-audio'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await installYouTubePreviewMock(context)
  const uiBase = process.env.KARAOKE_E2E_HTTPS_URL || base
  if (process.env.KARAOKE_E2E_HTTPS_URL) {
    assert.equal(new URL(uiBase).protocol, 'https:')
    await isolateHttps(context)
  }
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${uiBase}account?roomId=1`)
  await page.getByLabel('Tu nombre').fill('Cliente prueba')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page).toHaveURL(`${uiBase}library`)
  const input = page.getByRole('searchbox', { name: 'Buscar canción o artista' })
  await expect(input).toBeFocused()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: path.join(data, `search-focus-${width}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.type('Canción')
  await expect(input).toHaveValue('Canción')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Limpiar búsqueda', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(input).toBeFocused()
  pass('Search receives focus after guest login, accepts typing and preserves keyboard navigation')
  const search = async () => {
    await page.getByRole('radio', { name: 'Cantar karaoke', exact: true }).check()
    const input = page.getByRole('searchbox', { name: 'Buscar canción o artista' })
    await input.fill('Canción')
    await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeEnabled()
    await input.press('Enter')
    await expect(page.locator('article[data-source-id]')).toHaveCount(3)
  }
  await input.fill('Canción')
  await input.press('Enter')
  await expect(page.locator('article[data-source-id]')).toHaveCount(4)
  assert.equal(lastSearchQuery, 'Canción video oficial')
  await page.getByRole('radio', { name: 'Cantar karaoke', exact: true }).focus()
  await page.keyboard.press('Space')
  await input.press('Enter')
  await expect(page.locator('article[data-source-id]')).toHaveCount(3)
  assert.equal(lastSearchQuery, 'Canción karaoke')
  await expect(page.getByRole('heading', { name: titles[1], exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: titles[2], exact: true })).toBeVisible()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: path.join(data, `karaoke-results-${width}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await input.fill(`https://youtu.be/${nonKaraokeId}`)
  await input.press('Enter')
  const titleNotice = page.getByText('Para cantar, elige un video con «karaoke» o «Karaokanta» en el título. Busca otra versión o cambia a «Escuchar música».', { exact: true })
  await expect(titleNotice).toBeVisible()
  await expect(page.locator('article[data-source-id]')).toHaveCount(0)
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `karaoke-title-${width}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('radio', { name: 'Escuchar música', exact: true }).check()
  await input.press('Enter')
  await expect(page.locator(`[data-source-id="${nonKaraokeId}"]`)).toBeVisible()
  assert.equal(count(), 0)
  pass('Karao title filter, guide vocals allowed, keyboard mode switch and direct-link recovery to listening')
  await search()
  const searchesBeforeClear = searchCalls
  const clearSearch = page.getByRole('button', { name: 'Limpiar búsqueda', exact: true })
  await clearSearch.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await expect(clearSearch).toHaveCount(0)
  await expect(page.locator('article[data-source-id]')).toHaveCount(0)
  assert.equal(searchCalls, searchesBeforeClear, 'clearing does not submit a search')
  await search()
  pass('Clear icon clears results and returns focus without searching')
  const first = page.locator(`[data-source-id="${ids[0]}"]`)
  const second = page.locator(`[data-source-id="${ids[1]}"]`)
  const third = page.locator(`[data-source-id="${ids[2]}"]`)
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Confirmar', exact: true })
  await page.evaluate(() => {
    window.previewTest.mode = 'ready'
  })
  await first.getByRole('button', { name: 'Pedir', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByText('Comprobando reproducción…')).toBeVisible()
  assert.equal(count(), 0, 'opening/ready/cued must not enqueue')
  await dialog.getByRole('button', { name: 'Reproducir video simulado', exact: true }).click()
  await expect(confirm).toBeEnabled()
  assert.equal(await page.evaluate(() => window.previewTest.instances.filter(p => !p.destroyed).at(-1).options.playerVars.controls), 0)
  await expect(dialog.getByRole('group', { name: 'Controles de vista previa' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /^(Pausar|Reproducir|Silenciar|Activar sonido)$/ })).toHaveCount(0)
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: path.join(data, `preview-${width}.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(first.getByRole('button', { name: 'Pedir', exact: true })).toBeFocused()
  assert.equal(await page.evaluate(() => window.previewTest.instances.filter(p => !p.destroyed).length), 0)
  assert.equal(count(), 0)
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const artwork = await first.getByRole('button', { name: /^Previsualizar / }).boundingBox()
    const cardBox = await first.boundingBox()
    const requestButton = await first.getByRole('button', { name: 'Pedir', exact: true }).boundingBox()
    const title = await first.getByRole('heading').boundingBox()
    const channel = await first.getByText('Canal de prueba', { exact: true }).boundingBox()
    assert.ok(artwork.width > cardBox.width * 0.5, 'thumbnail takes more than half the card width')
    assert.ok(title.y >= artwork.y + artwork.height, 'title is below the artwork')
    assert.ok(title.width > cardBox.width * 0.85 && channel.width === title.width, 'title and channel span the card')
    assert.ok(Math.abs(requestButton.y + requestButton.height / 2 - artwork.y - artwork.height / 2) < 2, 'request action is centered beside the artwork')
    assert.ok(requestButton.width < cardBox.width * 0.5, 'request button does not stretch across the card')
    assert.ok(requestButton.height >= 44, 'compact action keeps its touch target')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `cards-${width}.png`) })
  }
  pass('Keyboard modal, actual playback gate, responsive layouts, cancel and player teardown')

  await page.evaluate(() => {
    window.previewTest.mode = 'autoplay'
  })
  await first.getByRole('button', { name: /^Previsualizar / }).click()
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByText('Toca el video para reproducir.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Reproducir video simulado', exact: true }).click()
  await expect(confirm).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(first.getByRole('button', { name: /^Previsualizar / })).toBeFocused()
  pass('Play overlay opens the same modal; autoplay denial is recoverable')

  await page.evaluate(() => {
    window.previewTest.mode = 'error'
    window.previewTest.code = 5
  })
  await first.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(dialog.getByText('No se pudo reproducir el video. Reintenta.')).toBeVisible()
  await expect(confirm).toBeDisabled()
  await page.evaluate(() => {
    window.previewTest.mode = 'playing'
  })
  await dialog.getByRole('button', { name: 'Reintentar', exact: true }).click()
  await expect(confirm).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(first.getByRole('button', { name: 'Pedir', exact: true })).toBeEnabled()
  pass('Temporary errors retry without blacklisting the song')

  await page.evaluate(() => {
    window.previewTest.mode = 'timeout'
  })
  await first.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(dialog.getByText('No se pudo cargar el video. Reintenta.')).toBeVisible({ timeout: 18000 })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  pass('Loading timeout is inconclusive and does not enqueue')

  await page.evaluate(() => {
    window.previewTest.mode = 'error'
    window.previewTest.code = 150
  })
  await second.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(dialog.getByText('YouTube bloquea esta versión aquí. Elige otra versión.')).toBeVisible()
  await expect(confirm).toBeDisabled()
  await expect(second).toHaveAttribute('data-state', 'unavailable')
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(second).toBeFocused()
  await expect(second.getByRole('button', { name: 'Pedir', exact: true })).toBeDisabled()
  await page.reload()
  await search()
  await expect(second.getByRole('button', { name: 'Pedir', exact: true })).toBeDisabled()
  await expect(second.getByText('No disponible', { exact: true })).toBeVisible()
  assert.equal(count(), 0)
  pass('Confirmed restriction updates card immediately and survives a new search/reload')

  await third.getByRole('button', { name: 'Pedir', exact: true }).click()
  await expect(confirm).toBeEnabled()
  await page.evaluate(() => window.previewTest.fail(100))
  await expect(confirm).toBeDisabled()
  await expect(dialog.getByText('Este video no está disponible. Elige otra versión.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  pass('A late video error revokes earlier playback eligibility')

  await first.getByRole('button', { name: 'Pedir', exact: true }).click()
  await confirm.dblclick()
  await expect(page).toHaveURL(`${uiBase}requests`)
  assert.equal(count(), 1)
  const row = db.prepare('SELECT * FROM queue').get()
  assert.equal(row.status, 'PENDING_APPROVAL')
  assert.equal(row.requestIntent, 'SING')
  await expect(page.locator(`[data-queue-id="${row.queueId}"]`).getByRole('heading')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Agregar saludo', exact: true })).toBeVisible()
  assert.equal(await page.evaluate(() => window.previewTest.instances.filter(p => !p.destroyed).length), 0)
  pass('Confirm submits one request with intent, navigates to Mis pedidos and preserves greeting flow')
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: path.join(data, `requests-${width}.png`) })
  }
  await page.goto(`${uiBase}account`)
  const displayName = page.getByRole('textbox', { name: 'Nombre para mostrar', exact: true })
  await expect(displayName).toHaveValue('Cliente prueba')
  await expect(displayName).not.toHaveAttribute('aria-describedby')
  await displayName.fill('Uno Dos Tres')
  await page.getByRole('button', { name: 'Actualizar cuenta', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(displayName).toBeFocused()
  await expect(displayName).toHaveAttribute('aria-invalid', 'true')
  await expect(displayName).toHaveAccessibleDescription('Escribe solo una o dos palabras.')
  await displayName.fill('Cliente prueba')
  await expect(displayName).not.toHaveAttribute('aria-describedby')
  await expect(page.locator('#account-name-error')).toHaveCount(0)
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.screenshot({ path: path.join(data, `account-${width}.png`) })
  }
  pass('Guest name validation remains accessible and clears after correction')
  assert.deepEqual(errors, [])
  console.log(`Evidence: ${data}; mode=${development ? 'development/StrictMode' : 'production'}; UI=${uiBase}; simulated provider/player`)
  if (process.env.KARAOKE_E2E_REAL_PREVIEW === '1') {
    assert.ok(process.env.KARAOKE_E2E_HTTPS_URL, 'Live iframe smoke uses the HTTPS origin')
    const liveContext = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState() })
    await isolateHttps(liveContext)
    let apiLoads = 0
    await liveContext.route('https://www.youtube.com/iframe_api', route => ++apiLoads === 1 ? route.abort() : route.continue())
    const live = await liveContext.newPage()
    for (const [id, blocked] of [['bAWQ7B3rRAo', true], ['jNQXAC9IVRw', false]]) {
      await live.goto(`${uiBase}library`)
      const input = live.getByRole('searchbox', { name: 'Buscar canción o artista' })
      await input.fill(`https://youtu.be/${id}`)
      await live.getByRole('button', { name: 'Buscar', exact: true }).click()
      const card = live.locator(`[data-source-id="${id}"]`)
      await card.getByRole('button', { name: 'Pedir', exact: true }).click()
      const preview = live.getByRole('dialog')
      if (blocked) {
        await expect(preview.getByText('No se pudo reproducir el video. Reintenta.')).toBeVisible()
        await expect(card).not.toHaveAttribute('data-state', 'unavailable')
        await preview.getByRole('button', { name: 'Reintentar', exact: true }).click()
        await expect(preview.getByText('YouTube bloquea esta versión aquí. Elige otra versión.')).toBeVisible({ timeout: 20000 })
        await expect(card).toHaveAttribute('data-state', 'unavailable')
        await expect(preview.getByRole('button', { name: 'Confirmar', exact: true })).toBeDisabled()
      } else {
        const manualNotice = preview.getByText('Toca el video para reproducir.')
        await expect.poll(async () => (await preview.getByRole('button', { name: 'Confirmar', exact: true }).isEnabled()) || (await manualNotice.isVisible()), { timeout: 20000 }).toBe(true)
        if (await manualNotice.isVisible()) await live.frameLocator('iframe[src*="youtube.com/embed"]').locator('video').click()
        await expect(preview.getByRole('button', { name: 'Confirmar', exact: true })).toBeEnabled({ timeout: 20000 })
        await expect(live.locator('iframe[src*="youtube.com/embed"]')).toHaveAttribute('src', /controls=0/)
        await expect(preview.getByRole('button', { name: /^(Pausar|Reproducir|Silenciar|Activar sonido)$/ })).toHaveCount(0)
      }
      await live.screenshot({ path: path.join(data, `https-real-${blocked ? 'blocked' : 'playing'}.png`) })
      await preview.getByRole('button', { name: 'Cancelar', exact: true }).click()
      await expect(live.locator('iframe[src*="youtube.com/embed"]')).toHaveCount(0)
      assert.equal(count(), 1, 'Live provider previews must not enqueue anything')
      pass(`Real HTTPS YouTube iframe: ${id} ${blocked ? 'restriction detected' : 'playback confirmed'}; isolated metadata/backend, no requests submitted`)
    }
  }
  await checkParticipantStatuses({ page, api, db, base, uiBase, data, queueId: row.queueId })
  assert.deepEqual(errors, [])
} catch (error) {
  console.error(`Evidence: ${data}`, errors)
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    console.error(page.url(), await page.locator('body').innerText().catch(() => 'unavailable'))
    await page.screenshot({ path: path.join(data, `failure-${browser.contexts().indexOf(context)}.png`) }).catch(() => {})
  }
  throw error
} finally {
  for (const context of browser?.contexts() ?? []) await context.unrouteAll({ behavior: 'ignoreErrors' })
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
