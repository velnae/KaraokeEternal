import { chromium, request, expect } from 'playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ke-tts-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const portServer = createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const api = await request.newContext()
const anonymous = await request.newContext()
let server, browser, page
const errors = []
const pass = name => console.log(`PASS ${name}`)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const call = async (suffix = '', body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const status = () => call('prefs/local-tts')
const waitFor = async (predicate, message, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const current = await status()
    if (predicate(current)) return current
    await sleep(100)
  }
  throw new Error(`${message}: ${JSON.stringify(await status())}`)
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '' },
  })
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${base}api/prefs`)).ok) return
    } catch { /* Wait for startup. */ }
    await sleep(100)
  }
  throw new Error(`Server did not start; inspect ${data}/server.log`)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exit = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exit
}
const fixture = (name) => {
  const directory = path.join(data, name)
  fs.mkdirSync(path.join(directory, '.tmp'), { recursive: true })
  fs.mkdirSync(path.join(directory, '.venv/bin'), { recursive: true })
  fs.symlinkSync(process.execPath, path.join(directory, '.venv/bin/python'))
  fs.writeFileSync(path.join(directory, 'resident.py'), '# Test installation marker\n')
  fs.writeFileSync(path.join(directory, 'speak.py'), '# Test installation marker\n')
  fs.writeFileSync(path.join(directory, 'model.sh'), `#!/bin/bash\nexec '${process.execPath}' worker.mjs\n`)
  fs.writeFileSync(path.join(directory, 'worker.mjs'), `
    import fs from 'node:fs';
    import { createServer } from 'node:net';
    fs.appendFileSync('starts', process.pid + '\\n');
    const pending = new Set();
    const server = createServer(socket => {
      socket.on('error', () => {});
      socket.once('close', () => pending.delete(socket));
      socket.once('data', bytes => {
        const action = JSON.parse(bytes.toString()).action;
        fs.appendFileSync('requests', action + '\\n');
        if (action !== 'status') process.exit(20);
        pending.add(socket);
      });
    });
    const timer = setInterval(() => {
      if (fs.existsSync('busy')) return;
      for (const socket of pending) socket.end(JSON.stringify({ok:true,result:{status:'ready',pid:process.pid}}) + '\\n');
      pending.clear();
    }, 30);
    process.on('SIGTERM', () => {
      clearInterval(timer);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 200).unref();
    });
    setTimeout(() => {
      fs.rmSync('.tmp/model.sock', { force:true });
      server.listen('.tmp/model.sock');
    }, 300);
  `)
  return directory
}

try {
  const first = fixture('installation-a')
  const second = fixture('installation-b')
  await start()
  await call('setup', { username: 'admin', newPassword: 'local-tts-test', newPasswordConfirm: 'local-tts-test', name: 'Operator' })
  await call('login', { username: 'admin', password: 'local-tts-test', roomId: 1 })
  for (const [suffix, method] of [['', 'GET'], ['', 'PUT'], ['/start', 'POST'], ['/check', 'POST']]) {
    assert.equal((await anonymous.fetch(`${base}api/prefs/local-tts${suffix}`, { method, data: method === 'PUT' ? {} : undefined })).status(), 403)
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}account?roomId=1`)
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('local-tts-test')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await page.goto(`${base}admin/settings/animator?view=local-voice`)
  const panel = page.getByRole('region', { name: 'Voz local para saludos' })
  const input = panel.getByLabel('Ruta de instalación en el servidor', { exact: true })
  const save = panel.getByRole('button', { name: 'Guardar y comprobar', exact: true })
  await expect(input).toBeEnabled()
  await expect(panel.getByText('Sin configurar', { exact: true })).toBeVisible()
  await input.fill('/missing/chatterbox')
  await save.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('alert')).toContainText('instalación accesible')
  assert.equal((await status()).config.revision, 0)
  await input.fill(first)
  await save.click()
  await expect(panel.getByText('Sin conexión', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Iniciar modelo', exact: true })).toBeEnabled()
  pass('Admin-only configuration, invalid path and actionable disconnected state')

  await panel.getByRole('button', { name: 'Iniciar modelo', exact: true }).focus()
  await page.keyboard.press('Enter')
  const firstReady = await waitFor(state => state.state === 'ready', 'First worker not ready')
  await expect(panel.getByText('Modelo listo', { exact: true })).toBeVisible()
  assert.equal(firstReady.managed, true)
  assert.equal(fs.readFileSync(path.join(first, 'starts'), 'utf8').trim().split('\n').length, 1)
  await panel.getByRole('checkbox', { name: 'Iniciar el modelo automáticamente al abrir el servidor' }).focus()
  await page.keyboard.press('Space')
  await save.click()
  await waitFor(state => state.state === 'ready', 'Worker lost after enabling automatic startup')
  await expect(panel.getByText('Modelo listo', { exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1050 })
    await panel.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`)
    await expect(save).toBeVisible()
    await page.screenshot({ path: path.join(data, `ready-${width}.png`) })
  }
  pass('Keyboard start, singleton ownership and mobile/desktop settings')

  fs.writeFileSync(path.join(first, 'busy'), '')
  await panel.getByRole('button', { name: 'Comprobar conexión', exact: true }).click()
  await expect(panel.getByText('Ocupado o sin respuesta', { exact: true })).toBeVisible()
  const requestCount = fs.readFileSync(path.join(first, 'requests'), 'utf8').trim().split('\n').length
  await input.fill(second)
  await save.click()
  await expect(panel.getByText(/Cambio pendiente\. Instalación actual:/)).toBeVisible()
  assert.equal((await status()).activePath, first)
  assert.equal(fs.existsSync(path.join(second, 'starts')), false)
  await sleep(1700)
  assert.equal(fs.readFileSync(path.join(first, 'requests'), 'utf8').trim().split('\n').length, requestCount)
  await page.screenshot({ path: path.join(data, 'pending-path.png') })
  fs.unlinkSync(path.join(first, 'busy'))
  const secondReady = await waitFor(state => state.state === 'ready' && state.activePath === second && !state.pending, 'Path switch did not complete')
  assert.notEqual(secondReady.pid, firstReady.pid)
  assert.throws(() => process.kill(firstReady.pid, 0))
  assert.equal(fs.readFileSync(path.join(second, 'starts'), 'utf8').trim().split('\n').length, 1)
  pass('Busy worker retains one probe; hot path change waits and releases only its owned process')

  await stop()
  assert.throws(() => process.kill(secondReady.pid, 0))
  await start()
  const restored = await waitFor(state => state.state === 'ready', 'Automatic startup after restart failed')
  assert.equal(restored.config.installationPath, second)
  assert.equal(restored.config.autoStart, true)
  assert.notEqual(restored.pid, secondReady.pid)
  assert.ok(!JSON.stringify(await (await anonymous.get(`${base}api/prefs`)).json()).includes(second))
  await page.reload()
  await expect(input).toHaveValue(second)
  pass('Persistence, asynchronous auto-start after restart, private path and owned shutdown')

  if (process.env.KES_TTS_TEST_INSTALLATION) {
    const config = (await status()).config
    await call('prefs/local-tts', { ...config, installationPath: process.env.KES_TTS_TEST_INSTALLATION, autoStart: true }, 'PUT')
    const real = await waitFor(state => state.state === 'ready' && state.activePath === process.env.KES_TTS_TEST_INSTALLATION, 'Real Chatterbox did not respond', 125000)
    console.log(`PASS Real Chatterbox status only: pid=${real.pid}, managed=${real.managed}`)
    await stop()
    if (real.managed) assert.throws(() => process.kill(real.pid, 0))
    else process.kill(real.pid, 0)
  }
  assert.deepEqual(errors, [])
  console.log(`Local TTS ${development ? 'development' : 'production'} E2E passed. Artifacts: ${data}`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(data, 'failure.png') }).catch(() => {})
    fs.writeFileSync(path.join(data, 'failure.json'), JSON.stringify({ url: page.url(), errors, accessibility: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2))
  }
  console.error(`E2E failure artifacts: ${data}`)
  throw error
} finally {
  await browser?.close()
  await stop()
  await api.dispose()
  await anonymous.dispose()
  fs.closeSync(log)
}
