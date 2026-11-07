import { chromium, request, expect } from 'playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const development = process.env.KARAOKE_E2E_MODE === 'development'
const root = path.resolve(import.meta.dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moderation-e2e-'))
const log = fs.openSync(path.join(directory, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']), '--data', directory, '--port', String(port)], {
  cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_ROTATE_KEY: 'false', KES_SCAN: '', KES_GEMINI_API_KEY: '', KES_ELEVENLABS_API_KEY: '' },
})
const adminApi = await request.newContext()
const guestApi = await request.newContext()
let browser, db
const storedTerms = () => JSON.parse(db.prepare('SELECT data FROM prefs WHERE key=?').get('moderation').data).terms
const pages = []
const errors = []
const call = async (api, route, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${origin}/api/${route}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const seed = async (context, identity, targetOrigin = origin) => {
  await context.addInitScript(({ identity, targetOrigin }) => {
    if (window.top !== window || location.origin !== targetOrigin || localStorage.getItem('persist:user')) return
    localStorage.setItem('persist:user', JSON.stringify(Object.fromEntries(Object.entries(identity).map(([key, value]) => [key, JSON.stringify(value)]))))
  }, { identity, targetOrigin })
}
const pageFor = async (api, identity) => {
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } })
  await seed(context, identity)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  pages.push(page)
  return page
}
const add = async (page, term) => {
  await page.getByLabel('Agregar palabra o frase', { exact: true }).fill(term)
  await page.getByLabel('Agregar palabra o frase', { exact: true }).press('Enter')
}
const save = async (page) => {
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page.getByText('Diccionario guardado y aplicado a todas las salas.', { exact: true })).toBeVisible()
}

try {
  await expect.poll(async () => {
    try {
      return (await fetch(`${origin}/api/prefs`)).status
    } catch { return 0 }
  }, { timeout: 60000 }).toBe(200)
  const adminIdentity = await call(adminApi, 'setup', { username: 'admin', name: 'Operator', newPassword: 'moderation-test', newPasswordConfirm: 'moderation-test' })
  await call(adminApi, 'rooms/1', { name: 'Test room', status: 'open', prefs: { roles: { 4: { allowNew: true } }, tables: { mode: 'OFF' } } }, 'PUT')
  const guestIdentity = await call(guestApi, 'user', { role: 'guest', name: 'Ana', roomId: 1 })
  const forbidden = await guestApi.put(`${origin}/api/prefs/moderation`, { data: { terms: [] } })
  assert.equal(forbidden.status(), 403)
  db = new DatabaseSync(path.join(directory, 'database.sqlite3'))
  db.prepare(`INSERT INTO queue(queueId,roomId,userId,source,externalId,status,origin,title,artistOrChannel) VALUES(1,1,?,'YOUTUBE','AAAAAAAAAAA','APPROVED','PARTICIPANT','Canción de prueba','Artista')`).run(guestIdentity.userId)
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const admin = await pageFor(adminApi, adminIdentity)
  const guest = await pageFor(guestApi, guestIdentity)
  await admin.goto(`${origin}/admin/settings/moderation`)
  await expect(admin.getByRole('heading', { name: 'Moderación', exact: true })).toBeVisible()
  await expect(admin.getByRole('link', { name: 'Moderación', exact: true })).toHaveAttribute('aria-current', 'page')
  await guest.goto(`${origin}/requests`)
  await guest.getByRole('button', { name: 'Agregar saludo', exact: true }).click()
  await guest.getByLabel('Mensaje', { exact: true }).fill('Una maravilla')
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeEnabled()

  await add(admin, '  MARAVÍLLA  ')
  await expect(admin.getByRole('button', { name: 'Quitar maravilla', exact: true })).toBeVisible()
  await add(admin, 'maravilla')
  await expect(admin.getByRole('alert')).toContainText('ya está')
  await admin.getByLabel('Texto de prueba', { exact: true }).fill('¡Una MARAVÍLLA!')
  await expect(admin.getByText('Bloqueado por el término: “maravilla”.', { exact: true })).toBeVisible()
  await admin.getByLabel('Buscar en el diccionario', { exact: true }).fill('maravilla')
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1000 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.screenshot({ path: path.join(directory, `moderation-${width}.png`), fullPage: true })
  }
  await save(admin)
  await expect(guest.getByRole('alert')).toContainText('expresiones no permitidas')
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeDisabled()
  assert.ok(storedTerms().includes('maravilla'))

  // A failed save leaves both the persisted dictionary and local draft intact.
  await admin.getByRole('button', { name: 'Quitar maravilla', exact: true }).click()
  await admin.route('**/api/prefs/moderation', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Guardado temporalmente no disponible' }) }))
  await admin.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(admin.getByRole('alert')).toBeVisible()
  assert.ok(storedTerms().includes('maravilla'))
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeDisabled()
  await admin.unroute('**/api/prefs/moderation')
  await save(admin)
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeEnabled()
  await guest.context().setOffline(true)
  await add(admin, 'maravilla')
  await save(admin)
  await guest.context().setOffline(false)
  await expect(guest.getByRole('alert')).toContainText('expresiones no permitidas')
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeDisabled()
  await admin.getByRole('button', { name: 'Quitar maravilla', exact: true }).click()
  await save(admin)
  await expect(guest.getByRole('button', { name: 'Guardar saludo', exact: true })).toBeEnabled()
  await guest.getByLabel('Mensaje', { exact: true }).press('Tab')
  await guest.keyboard.press('Enter')
  await expect(guest.getByRole('group', { name: 'Saludo', exact: true })).toContainText('Una maravilla')
  await add(admin, 'maravilla')
  await save(admin)
  await expect.poll(() => db.prepare('SELECT status FROM greetings WHERE queueId=1').get()?.status).toBe('REMOVED')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=1').get().status, 'APPROVED')
  await admin.reload()
  await expect(admin.getByRole('button', { name: 'Quitar maravilla', exact: true })).toBeVisible()

  // Serve the actual shared HTTPS interface against this isolated test backend.
  // No admin settings or test greetings are written to the shared development data.
  if (process.env.KARAOKE_E2E_HTTPS === '1') {
    const httpsOrigin = 'https://karaoke.puyu.pe'
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await seed(context, adminIdentity, httpsOrigin)
    await context.routeWebSocket('**/socket.io/**', () => {})
    await context.route(`${httpsOrigin}/api/**`, async (route) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const response = await adminApi.fetch(`${origin}${url.pathname}${url.search}`, {
        method: incoming.method(), data: incoming.postData() ?? undefined,
        headers: { 'content-type': incoming.headers()['content-type'] || 'application/json' },
      })
      await route.fulfill({ response })
    })
    const https = await context.newPage()
    pages.push(https)
    https.on('pageerror', error => errors.push(error.message))
    await https.goto(`${httpsOrigin}/admin/settings/moderation`)
    await expect(https.getByRole('heading', { name: 'Moderación', exact: true })).toBeVisible()
    await add(https, 'ensayo privado')
    await https.getByLabel('Texto de prueba', { exact: true }).fill('Un ensayo privado aquí')
    await expect(https.getByText('Bloqueado por el término: “ensayo privado”.', { exact: true })).toBeVisible()
    for (const width of [390, 1440]) {
      await https.setViewportSize({ width, height: 1000 })
      await https.getByRole('main').evaluate((element) => {
        element.scrollTop = 0
      })
      assert.ok(await https.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await https.screenshot({ path: path.join(directory, `moderation-https-${width}.png`), fullPage: true })
      await https.getByLabel('Texto de prueba', { exact: true }).scrollIntoViewIfNeeded()
      await https.screenshot({ path: path.join(directory, `moderation-https-test-${width}.png`), fullPage: true })
    }
    await save(https)
    assert.ok(storedTerms().includes('ensayo privado'))
    console.log('PASS HTTPS interface with isolated persistence, keyboard entry and responsive layouts')
  }
  assert.deepEqual(errors, [])
  console.log(`PASS Moderation ${development ? 'development StrictMode' : 'production'}: permissions, persistence, live add/remove, failed-save recovery and pending greeting revalidation. Artifacts: ${directory}`)
} catch (error) {
  for (const [index, page] of pages.entries()) {
    if (!page.isClosed()) {
      await page.screenshot({ path: path.join(directory, `failure-${index}.png`) }).catch(() => {})
      fs.writeFileSync(path.join(directory, `failure-${index}.txt`), await page.locator('body').ariaSnapshot().catch(() => ''))
    }
  }
  throw error
} finally {
  await browser?.close()
  db?.close()
  if (server.exitCode === null && !server.signalCode) {
    const exit = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exit
  }
  await Promise.all([adminApi.dispose(), guestApi.dispose()])
  fs.closeSync(log)
  console.log(`Artifacts: ${directory}`)
}
