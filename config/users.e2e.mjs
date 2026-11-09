import { chromium, request, expect } from 'playwright/test'
import { io } from 'socket.io-client'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'users-ui-'))
const log = fs.openSync(path.join(directory, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const httpsOrigin = 'https://dev-karaoke.puyu.pe'
const https = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const uiBase = https ? `${httpsOrigin}/` : base
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KES_|KARAOKE_|DEV_PLAYER_|NODE_OPTIONS$)/.test(key)))
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--data', directory, '--port', String(port), '--urlPath', '/karaoke/'], {
  cwd: root, stdio: ['ignore', log, log], env: { ...env, NODE_ENV: 'development', KES_SCAN: '', KES_ROTATE_KEY: 'false' },
})
const admin = await request.newContext()
const guest = await request.newContext()
const offline = await request.newContext()
const errors = []
const confirmations = []
let browser, page, db, socket
const call = async (api, endpoint, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${endpoint}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const group = label => page.getByRole('group', { name: 'Tipo de cuenta' }).getByRole('button', { name: new RegExp(`^${label} \\(`) })
const table = () => page.getByRole('table')
const createAccount = async (label, username, name) => {
  await page.getByRole('button', { name: label, exact: true }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: label, exact: true })
  await dialog.getByLabel('Usuario o correo electrónico', { exact: true }).fill(username)
  await dialog.getByLabel('Contraseña', { exact: true }).fill('users-ui-test')
  await dialog.getByLabel('Confirmar contraseña', { exact: true }).fill('users-ui-test')
  await dialog.getByLabel('Nombre para mostrar', { exact: true }).fill(name)
  return dialog
}

try {
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. See ${directory}`)
    try {
      return (await admin.get(`${base}api/prefs`)).status()
    } catch { return 0 }
  }, { timeout: 120000 }).toBe(200)
  const identity = await call(admin, 'setup', { username: 'admin', name: 'Administración técnica', newPassword: 'users-ui-test', newPasswordConfirm: 'users-ui-test' })
  for (const [role, name] of [['operator', 'Operador desconectado'], ['manager', 'María López'], ['standard', 'Cantante registrado']]) {
    await call(admin, 'user', { username: role, name, role, newPassword: 'users-ui-test', newPasswordConfirm: 'users-ui-test' })
  }
  const room = (await call(admin, 'rooms/1')).entities[1]
  await call(admin, 'rooms/1', { name: room.name, status: 'open', prefs: { ...room.prefs, roles: { 4: { allowNew: true } }, tables: { mode: 'OFF' } } }, 'PUT')
  const onlineGuest = await call(guest, 'user', { role: 'guest', name: 'Invitado José', roomId: 1 })
  await call(offline, 'user', { role: 'guest', name: 'Invitada Ana', roomId: 1 })
  const cookie = (await guest.storageState()).cookies.map(item => `${item.name}=${item.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, reconnection: false, autoConnect: false })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
    socket.connect()
  })
  db = new DatabaseSync(path.join(directory, 'database.sqlite3'))
  db.prepare(`INSERT INTO users(username,password,name,roleId) VALUES('legacy-screen','unused','Pantalla legada',2)`).run()
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  const context = await browser.newContext({ storageState: https ? undefined : await admin.storageState(), viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(user => localStorage.setItem('persist:user', JSON.stringify(Object.fromEntries(Object.entries(user).map(([key, value]) => [key, JSON.stringify(value)])))), identity)
  if (https) {
    // Use the real development HTML/assets. Only data and polling use isolated APIs.
    assert.ok((await fetch(httpsOrigin, { signal: AbortSignal.timeout(15000) })).ok)
    await context.routeWebSocket('**/socket.io/**', connection => connection.close())
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      if (incoming.headers()['content-type']) headers['content-type'] = incoming.headers()['content-type']
      try {
        const response = await admin.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.ok()) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          return route.fulfill({ status: 200, contentType: 'text/plain', body: '0' + JSON.stringify(handshake) })
        }
        await route.fulfill({ response })
      } catch { await route.abort().catch(() => {}) }
    }
    await context.route(`${httpsOrigin}/api/**`, route => forward(route))
    await context.route(`${httpsOrigin}/socket.io/**`, route => forward(route, true))
  }
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', (dialog) => {
    confirmations.push(dialog.message())
    void dialog.accept()
  })
  await page.goto(`${uiBase}admin/users`)
  await expect(group('Personal')).toHaveAttribute('aria-pressed', 'true')
  await expect(table().getByRole('row')).toHaveCount(4)
  await expect(table().getByText('Operador desconectado', { exact: true })).toBeVisible()
  await expect(table().getByText('Invitado José', { exact: true })).toHaveCount(0)
  await page.getByLabel('Buscar usuarios', { exact: true }).fill('MARIA manager')
  await expect(table().getByRole('row')).toHaveCount(2)
  await expect(table().getByText('María López', { exact: true })).toBeVisible()
  await page.getByLabel('Buscar usuarios', { exact: true }).fill('nobody')
  await expect(page.getByText('No hay cuentas con estos filtros.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
  await expect(table().getByRole('row')).toHaveCount(4)
  const staffDialog = await createAccount('Crear personal', 'new-operator', 'Nueva operadora')
  await expect(staffDialog.getByLabel('Rol', { exact: true })).toHaveValue('operator')
  assert.deepEqual(await staffDialog.getByLabel('Rol').locator('option:not([disabled])').evaluateAll(options => options.map(option => option.value)), ['operator', 'manager', 'admin'])
  await staffDialog.getByRole('button', { name: 'Crear personal', exact: true }).click()
  await expect(staffDialog).toBeHidden()
  await expect(table().getByText('Nueva operadora', { exact: true })).toBeVisible()
  assert.equal(db.prepare(`SELECT roles.name FROM users JOIN roles USING(roleId) WHERE username='new-operator'`).get().name, 'operator')
  await page.getByRole('button', { name: 'Editar a Nueva operadora', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Editar personal: Nueva operadora', exact: true })
  await editor.getByLabel('Rol', { exact: true }).selectOption('manager')
  await editor.getByLabel('Nombre para mostrar', { exact: true }).fill('Encargada actualizada')
  await editor.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(table().getByText('Encargada actualizada', { exact: true })).toBeVisible()
  await page.reload()
  await expect(table().getByText('Encargada actualizada', { exact: true })).toBeVisible()

  await group('Registrados').focus()
  await page.keyboard.press('Enter')
  await expect(table().getByText('Cantante registrado', { exact: true })).toBeVisible()
  const registeredDialog = await createAccount('Crear cuenta', 'new-singer', 'Nueva cantante')
  await expect(registeredDialog.getByRole('combobox')).toHaveCount(0)
  await registeredDialog.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await expect(registeredDialog).toBeHidden()
  assert.equal(db.prepare(`SELECT roles.name FROM users JOIN roles USING(roleId) WHERE username='new-singer'`).get().name, 'standard')

  await group('Invitados').click()
  await expect(page.getByLabel('Filtrar usuarios')).toHaveValue('online')
  await expect(table().getByRole('row')).toHaveCount(2)
  await expect(table().getByText(onlineGuest.username, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Crear/ })).toHaveCount(0)
  await page.getByLabel('Filtrar usuarios').selectOption('1')
  await page.getByLabel('Buscar usuarios').fill('ana')
  await expect(page.getByText('No hay cuentas con estos filtros.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
  await expect(table().getByRole('row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Editar a Invitado José', exact: true }).click()
  const guestDialog = page.getByRole('dialog', { name: 'Editar invitado: Invitado José', exact: true })
  await expect(guestDialog.getByRole('textbox')).toHaveCount(1)
  await expect(guestDialog.locator('input[type="password"]')).toHaveCount(0)
  await expect(guestDialog.getByRole('combobox')).toHaveCount(0)
  await guestDialog.getByLabel('Nombre para mostrar', { exact: true }).fill('Invitado revisado')
  await guestDialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(guestDialog).toBeHidden()
  await expect(table().getByText('Invitado revisado', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Editar a Invitada Ana', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar invitado', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(table().getByText('Invitada Ana', { exact: true })).toHaveCount(0)
  assert.ok(confirmations.some(message => message.includes('Invitada Ana') && message.includes('canciones')))

  await group('Sistema').click()
  await expect(table().getByText('Pantalla legada', { exact: true })).toBeVisible()
  await expect(table().getByRole('button', { name: /^Editar/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Crear/ })).toHaveCount(0)
  await group('Personal').click()
  await createAccount('Crear personal', 'failed-save', 'Borrador conservado')
  const userRoute = https ? `${httpsOrigin}/api/user` : `${base}api/user`
  await context.route(userRoute, route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'No se pudo guardar. Intente de nuevo.' }))
  await page.getByRole('dialog').getByRole('button', { name: 'Crear personal', exact: true }).click()
  const errorDialog = page.getByRole('dialog', { name: 'Ocurrió un error', exact: true })
  await expect(errorDialog).toBeVisible()
  await errorDialog.getByRole('button', { name: 'Aceptar', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Crear personal', exact: true }).getByLabel('Nombre para mostrar')).toHaveValue('Borrador conservado')
  await context.unroute(userRoute)

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const box = await page.getByRole('dialog').boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `editor fits at ${width}`)
    await page.screenshot({ path: path.join(directory, `users-editor-${width}.png`) })
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.goto(`${uiBase}admin/rooms`)
  await page.getByRole('button', { name: /^Ver usuarios de Sala 1:/ }).click()
  await expect(group('Invitados')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Filtrar usuarios')).toHaveValue('1')
  await expect(table().getByText('Invitado revisado', { exact: true })).toBeVisible()
  await group('Personal').click()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByRole('main').evaluate((element) => {
      element.scrollTop = 0
    })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(directory, `users-list-${width}.png`) })
  }
  assert.deepEqual(errors, [])
  console.log(`PASS grouped users: offline staff, search, contextual CRUD, guest presence/room filters, reserved accounts, failed-save recovery, keyboard and responsive layouts${https ? ' with real development HTTPS assets and isolated data' : ''}. Artifacts: ${directory}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {})
    fs.writeFileSync(path.join(directory, 'failure.txt'), await page.locator('body').ariaSnapshot().catch(() => ''))
  }
  console.error(`Artifacts: ${directory}`)
  throw error
} finally {
  socket?.disconnect()
  await browser?.close()
  db?.close()
  await Promise.all([admin.dispose(), guest.dispose(), offline.dispose()])
  if (server.exitCode === null && !server.signalCode) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  fs.closeSync(log)
}
