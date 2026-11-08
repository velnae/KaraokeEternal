import { chromium, request, expect } from 'playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'
import { checkPlayerDisplay } from './player-display-checks.e2e.mjs'

const root = path.resolve(import.meta.dirname, '..')
const development = process.env.KARAOKE_E2E_MODE === 'development'
const httpsUi = process.env.KARAOKE_E2E_HTTPS_UI === '1'
const realYouTube = process.env.KARAOKE_E2E_REAL_YOUTUBE === '1'
const worktreeUi = process.env.KARAOKE_E2E_WORKTREE_UI === '1'
const data = fs.mkdtempSync('/tmp/opencode/player-display-')
const log = fs.openSync(path.join(data, 'server.log'), 'a')
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = `${origin}/karaoke/`
const uiBase = httpsUi ? 'https://karaoke.puyu.pe/' : base
const api = await request.newContext()
const secondApi = await request.newContext()
let server, browser, player, editor, socket, db
const errors = []
const call = async (suffix, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await api.fetch(`${base}api/${suffix}`, { method, data: body })
  assert.equal(response.status(), 200, await response.text())
  return response.json()
}
const emit = async (type, payload = {}) => {
  const response = await socket.timeout(6000).emitWithAck('action', { type, payload: { ...payload, expiresAt: Date.now() + 5000 } })
  assert.ok(!response.error, response.error)
  return response
}

try {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=6', '-t', '300',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', path.join(data, 'song.mp4')])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10', '-t', '1',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', path.join(data, 'background.mp4')])
  server = spawn(process.execPath, [...(development ? ['--import', 'tsx', 'server/main.ts'] : ['build/server/main.js']),
    '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    cwd: root, stdio: ['ignore', log, log], env: { ...process.env, NODE_ENV: development ? 'development' : 'production',
      KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error(`Server exited. Logs: ${data}`)
    try {
      return (await api.get(`${base}api/prefs`)).status()
    } catch {
      return 0
    }
  }, { timeout: 120000 }).toBe(200)
  await call('setup', { username: 'admin', name: 'Operator', newPassword: 'branding-test-password', newPasswordConfirm: 'branding-test-password' })
  await call('login', { username: 'admin', password: 'branding-test-password', roomId: 1 })
  await call('rooms', { name: 'Sala 2', status: 'open' })
  assert.equal((await secondApi.post(`${base}api/login`, { data: { username: 'admin', password: 'branding-test-password', roomId: 2 } })).status(), 200)
  db = new DatabaseSync(path.join(data, 'database.sqlite3'))
  for (const [index, intent] of ['LISTEN', 'SING', 'UNKNOWN'].entries()) {
    db.prepare(`INSERT INTO queue(queueId,roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin,requestIntent)
      VALUES(?,1,1,?,'YOUTUBE','aqz-KE-bpKQ',?,'Fixture','OPERATOR',?)`).run(index + 1, index || null, `${intent} fixture`, intent)
  }
  db.exec(`INSERT INTO artists(artistId,name,nameNorm) VALUES(1,'Fixture','fixture');
    INSERT INTO songs(songId,artistId,title,titleNorm) VALUES(1,1,'Local fixture','local fixture');
    INSERT INTO queue(queueId,roomId,userId,prevQueueId,source,songId,title,artistOrChannel,origin,requestIntent) VALUES(4,1,1,3,'LOCAL',1,'Local fixture','Fixture','OPERATOR','LISTEN');
    INSERT INTO queue(queueId,roomId,userId,source,externalId,title,artistOrChannel,origin,requestIntent) VALUES(10,2,1,'YOUTUBE','aqz-KE-bpKQ','Sala 2','Fixture','OPERATOR','LISTEN');
    UPDATE rooms SET data=json_set(data,'$.prefs.qr.isEnabled',json('true'),'$.prefs.tables.mode','REQUIRED_QR') WHERE roomId=1;`)
  db.prepare('INSERT INTO paths(pathId,path,priority,data) VALUES(1,?,1,?)').run(data, '{"prefs":{"isWatching":false}}')
  db.exec('INSERT INTO media(mediaId,songId,pathId,relPath,duration,isPreferred) VALUES(1,1,1,\'song.mp4\',300,1)')
  const uploaded = await api.post(`${base}api/animation/background/upload`, { multipart: {
    requestId: 'display-background', file: { name: 'background.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'background.mp4')) },
  } })
  assert.equal(uploaded.status(), 202)
  const background = await uploaded.json()
  await expect.poll(async () => (await call(`animation/background/videos/${background.id}`)).state).toBe('ready')
  await call('animation/background/', { videoId: background.id, dimOpacity: 0.55, revision: 0 }, 'PUT')
  const cookie = (await api.storageState()).cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
  socket = io(origin, { path: '/karaoke/socket.io', transports: ['websocket'], extraHeaders: { cookie }, autoConnect: false })
  socket.connect()
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, storageState: await api.storageState() })
  if (httpsUi) {
    assert.equal((await api.get('https://karaoke.puyu.pe/')).status(), 200, 'the real HTTPS tunnel must be reachable')
    if (worktreeUi) {
      // Exercise unmerged assets in the actual secure origin without replacing the shared server.
      await context.route('https://karaoke.puyu.pe/**', async (route) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/__webpack_hmr') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
        const response = await api.get(base + url.pathname.replace(/^\/(?:karaoke\/)?/, '') + url.search)
        if (route.request().resourceType() === 'document') {
          const headers = response.headers()
          delete headers['content-length']
          delete headers['content-encoding']
          await route.fulfill({ status: response.status(), headers, body: (await response.text()).replaceAll('/karaoke/', '/') })
        } else await route.fulfill({ response })
      })
    }
    const forward = async (route, socketTraffic = false) => {
      const incoming = route.request()
      const url = new URL(incoming.url())
      const suffix = socketTraffic ? `socket.io/${url.search}` : `api/${url.pathname.split('/api/')[1]}${url.search}`
      const headers = { 'accept-encoding': 'identity' }
      for (const name of ['content-type', 'range', 'if-range']) if (incoming.headers()[name]) headers[name] = incoming.headers()[name]
      try {
        const response = await api.fetch(base + suffix, { method: incoming.method(), headers, data: incoming.postDataBuffer() ?? undefined, timeout: 35000 })
        if (socketTraffic && incoming.method() === 'GET' && !url.searchParams.has('sid') && response.status() === 200) {
          const handshake = JSON.parse((await response.text()).slice(1))
          handshake.upgrades = []
          const responseHeaders = response.headers()
          delete responseHeaders['content-length']
          await route.fulfill({ status: 200, headers: responseHeaders, body: '0' + JSON.stringify(handshake) })
        } else await route.fulfill({ response })
      } catch {
        await route.abort('failed').catch(() => {})
      }
    }
    await context.route('https://karaoke.puyu.pe/api/**', route => forward(route))
    await context.route('https://karaoke.puyu.pe/socket.io/**', route => forward(route, true))
    await context.routeWebSocket('**/socket.io/**', socket => socket.close())
  }
  if (!realYouTube) {
    await installYouTubeTransitionFixture(context, path.join(data, 'song.mp4'))
    await context.addInitScript(() => {
      const Original = window.YT.Player
      window.YT.Player = class extends Original {
        constructor (...args) {
          super(...args)
          window.displayMock = this
        }
      }
    })
  }
  await context.addInitScript(() => {
    window.displayTransitionOverlap = false
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="transition-scene"]') && document.querySelector('[data-testid="player-display-overlay"]')) window.displayTransitionOverlap = true
      }).observe(document.body, { childList: true, subtree: true })
    })
  })
  editor = await context.newPage()
  player = await context.newPage()
  for (const page of [editor, player]) page.on('pageerror', error => errors.push(error.message))
  await checkPlayerDisplay({ browser, context, editor, player, api, secondApi, call, emit, db, base, uiBase, data, realYouTube, errors })
  assert.deepEqual(errors, [])
  console.log(`PASS display checklist (${development ? 'development StrictMode' : 'production'}${httpsUi ? ', HTTPS origin + isolated API/socket' : ''}${worktreeUi ? ', worktree assets' : ''}${realYouTube ? ', real YouTube' : ', media fixture'}). Artifacts: ${data}`)
} catch (error) {
  for (const [name, page] of [['player', player], ['editor', editor]]) if (page && !page.isClosed()) await page.screenshot({ path: path.join(data, `${name}-failure.png`) }).catch(() => {})
  console.error({ artifacts: data, errors })
  throw error
} finally {
  socket?.close()
  await browser?.close()
  if (server?.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  db?.close()
  await api.dispose()
  await secondApi.dispose()
  fs.closeSync(log)
}
