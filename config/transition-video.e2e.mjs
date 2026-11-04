import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runTransitionVideoUiChecks } from './transition-video-ui.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-video-e2e-'))
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const base = `http://127.0.0.1:${port}/karaoke/`
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const anonymous = await request.newContext()
const foreign = await request.newContext()
let server, browser, page, uploadFixture, uiApi
const errors = []
// HTTPS UI checks use real tunnel-served assets but keep every API request and
// mutation on the isolated fixture server. No shared administrator session is used.
const fetchRoute = async (route) => {
  const incoming = route.request()
  const url = new URL(incoming.url())
  const suffix = url.pathname.split('/api/')[1]
  if (httpsUi && suffix === 'animation/background/upload' && incoming.headers()['content-type']?.startsWith('multipart/form-data')) {
    // Browser interception may omit disk-backed File bytes. Reconstruct only this
    // known isolated fixture; unproxied local runs verify the native XHR byte path.
    const requestId = incoming.headers()['x-upload-request-id']
    return uiApi.fetch(`${base}api/${suffix}`, { method: 'POST', headers: { 'X-Upload-Request-Id': requestId },
      multipart: { requestId, file: { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: uploadFixture } } })
  }
  const headers = {}
  for (const name of ['content-type', 'range', 'if-range', 'x-upload-request-id']) {
    if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
  }
  return uiApi.fetch(`${base}api/${suffix}${url.search}`, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined })
}

const call = (context, suffix, options = {}) => context.fetch(`${base}api/${suffix}`, options)
const background = (suffix = '', options = {}, context = api) => call(context, `animation/background/${suffix}`, options)
const json = async (response, status = 200) => {
  assert.equal(response.status(), status, await response.text())
  return response.json()
}
const start = async () => {
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. See ${data}/server.log`)
    try {
      return (await call(anonymous, 'prefs')).status()
    } catch {
      return 0
    }
  }, { timeout: 120_000, intervals: [250, 500] }).toBe(200)
}
const stop = async () => {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const exited = new Promise(resolve => server.once('exit', resolve))
  server.kill('SIGTERM')
  await exited
}
const waitState = async (id, state) => {
  await expect.poll(async () => (await json(await background(`videos/${id}`))).state, { timeout: 15_000 }).toBe(state)
  await expect.poll(async () => (await json(await background())).capability.busy).toBe(false)
}

try {
  const source = path.join(data, 'fixture.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  uploadFixture = fs.readFileSync(source)
  await start()
  await json(await call(api, 'setup', { method: 'POST', data: { username: 'admin', name: 'Operator', newPassword: 'video-test-password', newPasswordConfirm: 'video-test-password' } }))
  await json(await call(api, 'rooms', { method: 'POST', data: { name: 'Other room', status: 'open' } }))
  for (const [context, roomId] of [[api, 1], [foreign, 2]]) {
    await json(await call(context, 'login', { method: 'POST', data: { username: 'admin', password: 'video-test-password', roomId } }))
  }
  assert.equal((await background('', {}, anonymous)).status(), 403)
  const uploaded = await json(await background('upload', { method: 'POST', headers: { 'X-Upload-Request-Id': 'real-upload' },
    multipart: { requestId: 'real-upload', title: 'Fondo de prueba', file: { name: 'video.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(source) } } }), 202)
  assert.equal(uploaded.state, 'preparing')
  await waitState(uploaded.id, 'ready')
  const overview = await json(await background('', { method: 'PUT', data: { videoId: uploaded.id, dimOpacity: 0.65, revision: 0 } }))
  assert.equal(overview.settings.revision, 1)
  const prepared = path.join(data, 'transition-video', `${uploaded.id}.mp4`)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', prepared], { encoding: 'utf8' }))
  assert.equal(probe.streams.length, 1)
  assert.equal(probe.streams[0].codec_type, 'video')
  const suffix = await background(`videos/${uploaded.id}/video`, { headers: { Range: 'bytes=-16' } })
  assert.equal(suffix.status(), 206)
  assert.deepEqual(await suffix.body(), fs.readFileSync(prepared).subarray(-16))
  assert.equal((await background(`videos/${uploaded.id}/video`, {}, foreign)).status(), 404)

  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
  uiApi = await request.newContext({ storageState: await api.storageState() })
  const context = await browser.newContext({ storageState: await api.storageState() })
  if (httpsUi) {
    await context.route('https://karaoke.puyu.pe/api/**', async (route) => {
      try {
        await route.fulfill({ response: await fetchRoute(route) })
      } catch (error) {
        // Requests from panels being closed can outlive the page during teardown.
        // Surface live bridge failures, but do not turn shutdown into an unhandled rejection.
        if (page && !page.isClosed() && browser?.isConnected()) errors.push(`${route.request().method()} ${new URL(route.request().url()).pathname}: ${error.message.split('\n')[0]}`)
        await route.abort('failed').catch(() => {})
      }
    })
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => route.abort().catch(() => {}))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /Warning:|Error Component Stack|Minified React error/.test(message.text())) errors.push(message.text())
  })
  const database = new DatabaseSync(path.join(data, 'database.sqlite3'))
  const publicActivity = () => ['queue', 'animationInterventions', 'catalogGenerationJobs', 'greetingAudioJobs'].map(table => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
  const before = publicActivity()
  let selectedId
  try {
    const readAmbience = () => ({
      ...JSON.parse(database.prepare('SELECT data FROM rooms WHERE roomId=1').get().data).prefs?.animation,
      controlVersion: database.prepare('SELECT controlVersion FROM animationRoomState WHERE roomId=1').get()?.controlVersion,
    })
    selectedId = await runTransitionVideoUiChecks({ page, uiBase, source, data, background, json, fetchRoute, httpsUi, readAmbience })
    assert.deepEqual(publicActivity(), before)
  } finally { database.close() }
  assert.equal(await page.evaluate(() => document.baseURI), uiBase)
  const failed = await json(await background('upload', { method: 'POST', multipart: { requestId: 'bad-replacement',
    file: { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('invalid') } } }), 202)
  await waitState(failed.id, 'failed')
  assert.equal((await json(await background())).selected.id, selectedId)
  await browser.close()
  browser = undefined
  await stop()
  await start()
  assert.equal((await json(await background())).settings.videoId, selectedId)
  assert.equal((await background(`videos/${selectedId}/poster`)).status(), 200)
  assert.deepEqual(errors, [])
  console.log(`PASS transition video upload, preview UI, keyboard, conflicts/reconciliation, media cleanup, responsive screenshots and restart (${development ? 'development' : 'production'}${httpsUi ? ', HTTPS UI with isolated API' : ''}). Artifacts: ${data}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(data, 'failure.png'), fullPage: true })
    console.error({ url: page.url(), errors, text: (await page.locator('body').innerText()).slice(0, 1800), artifacts: data })
  }
  throw error
} finally {
  await browser?.close()
  await stop()
  await Promise.all([api.dispose(), anonymous.dispose(), foreign.dispose(), uiApi?.dispose()])
  fs.closeSync(log)
}
