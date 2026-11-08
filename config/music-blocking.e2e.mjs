import { chromium, request, expect } from 'playwright/test'
import { installYouTubePreviewMock, confirmSongPreview } from './fixtures/youtube-preview.mjs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const development = process.env.KARAOKE_E2E_MODE === 'development'
const root = path.resolve(import.meta.dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-blocking-e2e-'))
const log = fs.openSync(path.join(directory, 'server.log'), 'a')
const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
const songs = [
  { id: 'fixture0001', title: 'Faraón Love Shady - Tema', channel: 'Karaoke Channel' },
  { id: 'fixture0002', title: 'Canción permitida (Karaoke)', channel: 'Artista de prueba' },
  { id: 'fixture0003', title: 'Otra canción (Karaoke)', channel: 'Otro artista' },
]
const thumbnail = 'https://i.ytimg.com/vi/fixture0002/hqdefault.jpg'
let thumbnailFails = false
const provider = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('content-type', 'application/json')
  if (url.pathname.endsWith('/search')) {
    const q = url.searchParams.get('q')
    const matches = q.includes('vacío') ? [] : q.toLowerCase().includes('fara') ? [songs[0]] : songs
    res.end(JSON.stringify({ items: matches.map(song => ({ id: { videoId: song.id } })) }))
  } else {
    const ids = url.searchParams.get('id').split(',')
    res.end(JSON.stringify({ items: songs.filter(song => ids.includes(song.id)).map(song => ({
      id: song.id, snippet: { title: song.title, channelTitle: song.channel, categoryId: '10', liveBroadcastContent: 'none', thumbnails: song.id === 'fixture0002' ? { high: { url: thumbnail } } : {} },
      contentDetails: { duration: song.id === 'fixture0002' ? 'PT3M5S' : 'PT3M' }, status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
    })) }))
  }
})
const providerPort = await listen(provider)
const reservation = createServer()
const port = await listen(reservation)
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const uiOrigin = process.env.KARAOKE_E2E_HTTPS === '1' ? 'https://karaoke.puyu.pe' : origin
const server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', directory, '--port', String(port)], {
  cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_ROTATE_KEY: 'false', KES_SCAN: '', KES_GEMINI_API_KEY: '', KES_ELEVENLABS_API_KEY: '',
    KES_YOUTUBE_API_KEY: 'fixture-key', KARAOKE_E2E_YOUTUBE_ORIGIN: `http://127.0.0.1:${providerPort}`, NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'config/fixtures/youtube-fetch.mjs')).href}` },
})
const api = await request.newContext()
let browser, db
const pages = []
const errors = []
const call = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${origin}/api/${route}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const contextFor = async (width, identity) => {
  const storage = identity ? await api.storageState() : { cookies: [], origins: [] }
  if (uiOrigin !== origin) storage.cookies = storage.cookies.map(cookie => ({ ...cookie, domain: new URL(uiOrigin).hostname }))
  const context = await browser.newContext({ viewport: { width, height: 900 }, storageState: storage })
  if (identity) await context.addInitScript((identity) => {
    if (window.top !== window || localStorage.getItem('persist:user')) return
    localStorage.setItem('persist:user', JSON.stringify(Object.fromEntries(Object.entries(identity).map(([key, value]) => [key, JSON.stringify(value)]))))
  }, identity)
  await installYouTubePreviewMock(context)
  await context.route(thumbnail, route => route.fulfill(thumbnailFails
    ? { status: 404, body: '' }
    : { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#111a28"/><circle cx="90" cy="90" r="55" fill="#76e0ec"/><path d="M180 30h30v120h-30zm50 30h30v90h-30z" fill="#edc47c"/></svg>' }))
  if (uiOrigin !== origin) {
    // Exercise tunnel-served UI against isolated authenticated APIs and socket polling.
    await context.route(/\/(api|socket\.io)\//, async (route) => {
      const url = new URL(route.request().url())
      const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` })
      let body = await response.text()
      if (url.pathname.includes('/socket.io/') && body.startsWith('0{')) body = '0' + JSON.stringify({ ...JSON.parse(body.slice(1)), upgrades: [] })
      await route.fulfill({ response, body })
    })
    await context.routeWebSocket(/\/socket\.io\//, ws => ws.close())
  }
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  pages.push(page)
  return page
}
const search = async (page, query) => {
  const input = page.getByRole('searchbox', { name: 'Buscar canción o artista', exact: true })
  await input.fill(query)
  await input.press('Enter')
}
try {
  await expect.poll(async () => {
    try {
      return (await fetch(`${origin}/api/prefs`)).status
    } catch { return 0 }
  }, { timeout: 60000 }).toBe(200)
  const identity = await call('setup', { username: 'admin', name: 'Operator', newPassword: 'music-blocking-test', newPasswordConfirm: 'music-blocking-test' })
  const room = (await call('rooms/1')).entities[1]
  await call('rooms/1', { name: 'Test room', status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OFF' }, queue: { approvalMode: 'AUTO', maxPendingPerParticipant: 2 } } }, 'PUT')
  db = new DatabaseSync(path.join(directory, 'database.sqlite3'))
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const admin = await contextFor(1440, identity)
  const guest = await contextFor(390)
  await admin.goto(`${uiOrigin}/admin/settings/music-blocking`)
  await expect(admin.getByRole('heading', { name: 'Música bloqueada', exact: true })).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Quitar bloqueo de Faraón Love Shady', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(directory, `admin-${width}.png`), fullPage: true })
  }
  await guest.goto(`${uiOrigin}/account?roomId=1`)
  await guest.getByLabel('Tu nombre', { exact: true }).fill('Ana Prueba')
  await guest.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(guest).toHaveURL(`${uiOrigin}/library`)
  await guest.getByRole('radio', { name: 'Cantar karaoke', exact: true }).check()
  await search(guest, 'canción')
  await expect(guest.locator('article[data-source-id]')).toHaveCount(2)
  await expect(guest.getByText('Algunos resultados no están disponibles por la política de contenido del local.', { exact: true })).toBeVisible()
  await search(guest, 'Faraón')
  await expect(guest.getByText('Estas canciones no están disponibles en este local. Busca otra canción o artista.', { exact: true })).toBeVisible()
  await expect(guest.locator('article[data-source-id]')).toHaveCount(0)
  await search(guest, 'https://youtu.be/fixture0001')
  await expect(guest.getByText('Esta canción no está disponible por la política de contenido del local. Elige otra canción.', { exact: true })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0)
  await guest.screenshot({ path: path.join(directory, 'guest-link-blocked.png'), fullPage: true })
  await search(guest, 'vacío')
  await expect(guest.getByText('Sin resultados.', { exact: true })).toBeVisible()
  await search(guest, 'https://youtu.be/fixture0002')
  await guest.getByRole('button', { name: 'Pedir', exact: true }).click()
  await confirmSongPreview(guest)
  await expect(guest).toHaveURL(`${uiOrigin}/requests`)
  await expect(guest.getByRole('dialog')).toHaveCount(0)
  await expect(guest.getByRole('heading', { name: songs[1].title, exact: true })).toBeVisible()
  await guest.getByRole('button', { name: 'Agregar saludo', exact: true }).click()
  await guest.getByLabel('Mensaje', { exact: true }).fill('Un saludo para quienes nos acompañan esta noche. Gracias por compartir esta canción con nosotros.')
  await guest.getByRole('button', { name: 'Guardar saludo', exact: true }).click()
  await expect(guest.getByRole('group', { name: 'Saludo', exact: true })).toBeVisible()
  const queueId = db.prepare('SELECT queueId FROM queue WHERE externalId=?').get('fixture0002').queueId
  db.prepare('UPDATE queue SET status=? WHERE queueId=?').run('PENDING_APPROVAL', queueId)

  // Block directly from the operator queue, using the exact resource identity.
  await admin.goto(`${uiOrigin}/queue`)
  await admin.getByRole('button', { name: 'Por aprobar (1)', exact: true }).click()
  const pendingCard = admin.locator(`[data-queue-id="${queueId}"]`)
  await expect(pendingCard.getByRole('button', { name: 'Rechazar solicitud', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    await pendingCard.screenshot({ path: path.join(directory, `queue-pending-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await pendingCard.getByRole('button', { name: 'Aprobar solicitud', exact: true }).click()
  await admin.getByRole('button', { name: 'Cola', exact: true }).click()
  const queueItem = admin.locator(`[data-queue-id="${queueId}"]`)
  await expect(queueItem.getByText('YouTube', { exact: true })).toHaveCount(0)
  await expect(queueItem.getByText('Aprobada', { exact: true })).toHaveCount(0)
  await expect(queueItem.locator('[data-intent="SING"]')).toHaveText('Karaoke')
  await expect(queueItem.getByRole('button', { name: 'Acciones de la canción', exact: true })).toHaveCount(1)
  await expect(queueItem.getByRole('button', { name: 'Más acciones', exact: true })).toHaveCount(0)
  await expect(queueItem.getByLabel('Duración: 3:05', { exact: true })).toBeVisible()
  await expect.poll(() => queueItem.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  const greeting = queueItem.getByRole('group', { name: 'Saludo', exact: true })
  await expect(greeting).toBeVisible()
  const trigger = queueItem.getByRole('button', { name: 'Acciones de la canción', exact: true })
  const menu = admin.getByRole('menu', { name: `Acciones: ${songs[1].title}`, exact: true })
  for (const [width, height] of [[1440, 900], [390, 844], [320, 480]]) {
    await admin.setViewportSize({ width, height })
    await trigger.scrollIntoViewIfNeeded()
    const before = await queueItem.boundingBox()
    const picture = await queueItem.locator('img').locator('..').boundingBox()
    const duration = await queueItem.getByLabel('Duración: 3:05', { exact: true }).boundingBox()
    const caption = await queueItem.getByRole('heading').boundingBox()
    const intent = await queueItem.locator('[data-intent]').boundingBox()
    assert.ok(Math.abs(picture.width / picture.height - 16 / 9) < 0.02)
    assert.ok(duration.x >= picture.x && duration.y + duration.height <= picture.y + picture.height + 1)
    assert.ok((await greeting.boundingBox()).width >= before.width - 36, 'greeting spans the entire card')
    if (width === 1440) assert.ok(intent.x > caption.x + caption.width, 'desktop metadata uses the horizontal space')
    else assert.ok(intent.y > caption.y + caption.height, 'mobile metadata stacks below the title')
    await queueItem.screenshot({ path: path.join(directory, `queue-artwork-${width}.png`) })
    await trigger.focus()
    await admin.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    const box = await menu.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, 'menu stays inside viewport')
    assert.equal((await queueItem.boundingBox()).height, before.height, 'menu does not resize the card')
    await admin.screenshot({ path: path.join(directory, `queue-menu-${width}.png`), fullPage: true })
    await admin.keyboard.press('End')
    await expect(menu.getByRole('menuitem').last()).toBeFocused()
    await admin.keyboard.press('Home')
    await admin.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: /^Quitar de la cola/ })).toBeFocused()
    await admin.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: /^Bloquear este video/ })).toBeFocused()
    await admin.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()
  }
  // Failed images keep their reserved frame and valid duration; unknown duration is omitted.
  thumbnailFails = true
  db.prepare('UPDATE queue SET durationSeconds=?,title=? WHERE queueId=?').run(3735, 'Presentación completa de la canción con un título extenso para comprobar el espacio disponible del operador', queueId)
  await admin.reload()
  await expect(queueItem.getByLabel('Duración: 1:02:15', { exact: true })).toBeVisible()
  await expect(queueItem.locator('img')).toHaveCount(0)
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    await queueItem.screenshot({ path: path.join(directory, `queue-artwork-fallback-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  db.prepare('UPDATE queue SET durationSeconds=NULL WHERE queueId=?').run(queueId)
  await admin.reload()
  await expect(queueItem.locator('[aria-label^="Duración:"]')).toHaveCount(0)
  thumbnailFails = false
  db.prepare('UPDATE queue SET durationSeconds=?,title=? WHERE queueId=?').run(185, songs[1].title, queueId)
  await admin.reload()
  await admin.setViewportSize({ width: 390, height: 844 })
  await trigger.click()
  await admin.mouse.click(2, 842)
  await expect(menu).toHaveCount(0)
  await trigger.focus()
  await admin.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem').last()).toBeFocused()
  await admin.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)

  // Editable rules stay compact and return focus to the same trigger on cancel.
  for (const kind of ['canción', 'artista']) {
    await trigger.click()
    await menu.getByRole('menuitem', { name: new RegExp(`^Bloquear ${kind}`) }).click()
    const dialog = admin.getByRole('dialog', { name: `Bloquear ${kind}`, exact: true })
    await expect(dialog.getByLabel('Artista', { exact: true })).toHaveValue('Artista de prueba')
    await expect(dialog.getByRole('combobox')).toHaveCount(0)
    if (kind === 'canción') await expect(dialog.getByLabel('Título de la canción')).toHaveValue(songs[1].title)
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  }
  await trigger.click()
  await menu.getByRole('menuitem', { name: /^Bloquear este video/ }).click()
  const blockDialog = admin.getByRole('dialog', { name: 'Bloquear este video', exact: true })
  await expect(blockDialog.getByRole('textbox')).toHaveCount(0)
  await expect(blockDialog.getByText(songs[1].title, { exact: true })).toBeVisible()
  await admin.screenshot({ path: path.join(directory, 'queue-block-dialog-mobile.png'), fullPage: true })
  await admin.route('**/api/prefs/music-blocking', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'No se pudo guardar el bloqueo.' }) }))
  await blockDialog.getByRole('button', { name: 'Bloquear', exact: true }).click()
  await expect(blockDialog.getByRole('alert')).toBeVisible()
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'APPROVED')
  await admin.unroute('**/api/prefs/music-blocking')
  await blockDialog.getByRole('button', { name: 'Bloquear', exact: true }).click()
  await expect(blockDialog).toHaveCount(0)
  await expect(admin.getByText('Bloqueo guardado: YouTube: fixture0002. Aplicado a todas las salas.', { exact: true })).toBeVisible()
  await expect(admin.getByText('Bloqueo guardado: YouTube: fixture0002. Aplicado a todas las salas.', { exact: true })).toBeFocused()
  await expect(guest.getByText('No disponible por política del local', { exact: true })).toBeVisible()
  await expect(guest.getByText('Tu pedido fue retirado. Puedes elegir otra canción.', { exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'REJECTED')
  await expect(guest.getByRole('link', { name: '0 de 2 pedidos pendientes', exact: true })).toBeVisible()
  await guest.screenshot({ path: path.join(directory, 'guest-withdrawn.png'), fullPage: true })
  await guest.getByRole('link', { name: 'Buscar otra canción', exact: true }).click()
  await search(guest, 'https://youtu.be/fixture0002')
  await expect(guest.getByText('Esta canción no está disponible por la política de contenido del local. Elige otra canción.', { exact: true })).toBeVisible()

  await admin.goto(`${uiOrigin}/admin/settings/music-blocking`)
  await admin.reload()
  await expect(admin.getByRole('button', { name: 'Quitar bloqueo de YouTube: fixture0002', exact: true })).toBeVisible()
  admin.once('dialog', dialog => dialog.accept())
  await admin.getByRole('button', { name: 'Quitar bloqueo de YouTube: fixture0002', exact: true }).click()
  await expect(admin.getByRole('button', { name: 'Quitar bloqueo de YouTube: fixture0002', exact: true })).toHaveCount(0)
  await search(guest, 'https://youtu.be/fixture0002')
  await expect(guest.locator('article[data-source-id]')).toHaveCount(1)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'REJECTED')

  // Removing a request never creates a persistent block.
  await guest.getByRole('button', { name: 'Pedir', exact: true }).click()
  await confirmSongPreview(guest)
  await expect(guest).toHaveURL(`${uiOrigin}/requests`)
  const removableId = db.prepare('SELECT queueId FROM queue WHERE status=? ORDER BY queueId DESC LIMIT 1').get('APPROVED').queueId
  await admin.goto(`${uiOrigin}/queue`)
  await admin.locator(`[data-queue-id="${removableId}"]`).getByRole('button', { name: 'Acciones de la canción', exact: true }).click()
  await admin.getByRole('menuitem', { name: /^Quitar de la cola/ }).click()
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(removableId).status).toBe('REMOVED')
  assert.equal(JSON.parse(db.prepare('SELECT data FROM prefs WHERE key=?').get('musicBlocking').data).rules.length, 1)

  // The formerly hidden long-press action is explicit and still asks for confirmation.
  for (const id of ['fixture0002', 'fixture0003']) {
    await guest.goto(`${uiOrigin}/library`)
    await search(guest, `https://youtu.be/${id}`)
    await guest.getByRole('button', { name: 'Pedir', exact: true }).click()
    await confirmSongPreview(guest)
    await expect(guest).toHaveURL(`${uiOrigin}/requests`)
  }
  await admin.reload()
  await admin.getByRole('button', { name: 'Acciones de la canción', exact: true }).first().click()
  admin.once('dialog', dialog => dialog.dismiss())
  await admin.getByRole('menuitem', { name: /^Quitar próximos pedidos/ }).click()
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM queue WHERE status=?').get('APPROVED').count, 2)
  await admin.getByRole('button', { name: 'Acciones de la canción', exact: true }).first().click()
  admin.once('dialog', dialog => dialog.accept())
  await admin.getByRole('menuitem', { name: /^Quitar próximos pedidos/ }).click()
  await expect.poll(() => db.prepare('SELECT COUNT(*) AS count FROM queue WHERE status=?').get('APPROVED').count).toBe(0)
  await admin.goto(`${uiOrigin}/admin/settings/music-blocking`)

  // A failed save retains entered fields; keyboard submission then persists the artist.
  await admin.getByLabel('Artista', { exact: true }).fill('Otro artista')
  await admin.route('**/api/prefs/music-blocking', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Guardado temporalmente no disponible' }) }))
  await admin.getByRole('button', { name: 'Guardar bloqueo', exact: true }).click()
  await expect(admin.getByRole('alert')).toBeVisible()
  await expect(admin.getByLabel('Artista', { exact: true })).toHaveValue('Otro artista')
  await admin.unroute('**/api/prefs/music-blocking')
  await admin.getByRole('button', { name: 'Guardar bloqueo', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect(admin.getByRole('button', { name: 'Quitar bloqueo de Otro artista', exact: true })).toBeVisible()
  await guest.goto(`${uiOrigin}/library`)
  await search(guest, 'https://youtu.be/fixture0003')
  await expect(guest.getByText('Esta canción no está disponible por la política de contenido del local. Elige otra canción.', { exact: true })).toBeVisible()

  // Local queue items use the same menu with a resource-specific confirmation.
  const artistId = db.prepare('INSERT INTO artists(name,nameNorm) VALUES(?,?)').run('Artista local', 'artista local').lastInsertRowid
  const songId = db.prepare('INSERT INTO songs(artistId,title,titleNorm) VALUES(?,?,?)').run(artistId, 'Canción local', 'cancion local').lastInsertRowid
  const localId = db.prepare('INSERT INTO queue(roomId,userId,songId,source,status,origin,title,artistOrChannel) VALUES(?,?,?,?,?,?,?,?)').run(1, identity.userId, songId, 'LOCAL', 'APPROVED', 'PARTICIPANT', 'Canción local', 'Artista local').lastInsertRowid
  await admin.goto(`${uiOrigin}/queue`)
  const localTrigger = admin.locator(`[data-queue-id="${localId}"]`).getByRole('button', { name: 'Acciones de la canción', exact: true })
  await localTrigger.click()
  await admin.getByRole('menuitem', { name: /^Bloquear este archivo/ }).click()
  const localDialog = admin.getByRole('dialog', { name: 'Bloquear este archivo', exact: true })
  await expect(localDialog.getByText('Canción local', { exact: true })).toBeVisible()
  await expect(localDialog.getByRole('textbox')).toHaveCount(0)
  await admin.keyboard.press('Escape')
  await expect(localDialog).toHaveCount(0)
  await expect(localTrigger).toBeFocused()
  assert.deepEqual(errors, [])
  console.log(`PASS music blocking ${development ? 'development StrictMode' : 'production'} ${uiOrigin}: search, requests, queue menu, compact video/local/song/artist dialogs, withdrawal, removal without blocking, bulk removal confirmation, persistence, failed save, keyboard focus and responsive boundaries. Artifacts: ${directory}`)
} catch (error) {
  for (const [index, page] of pages.entries()) {
    await page.screenshot({ path: path.join(directory, `failure-${index}.png`), fullPage: true }).catch(() => {})
    fs.writeFileSync(path.join(directory, `failure-${index}.txt`), await page.locator('body').ariaSnapshot().catch(() => ''))
  }
  throw error
} finally {
  for (const page of pages) await page.context().unrouteAll({ behavior: 'ignoreErrors' })
  await browser?.close()
  db?.close()
  if (server.exitCode === null && !server.signalCode) {
    const exit = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exit
  }
  await api.dispose()
  await new Promise(resolve => provider.close(resolve))
  fs.closeSync(log)
  console.log(`Artifacts: ${directory}`)
}
