import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { request } from 'playwright'
import { applyPromotion, connect, planPromotion } from './promote-resources.js'
import { readJSON, writeJSON } from './media-import.js'

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'promotion-e2e-'))
const servers = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function start (name) {
  const data = path.join(directory, name)
  await fs.mkdir(data)
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const log = openSync(path.join(data, 'server.log'), 'a')
  const process = spawn(globalThis.process.execPath, ['--import', 'tsx', 'server/main.ts', '--data', data, '--port', String(port), '--urlPath', '/karaoke/', '--serverLogLevel', '0'], {
    stdio: ['ignore', log, log], env: { ...globalThis.process.env, NODE_ENV: 'production', KES_SCAN: '', KES_ROTATE_KEY: 'false', KES_ELEVENLABS_API_KEY: '', KES_GEMINI_API_KEY: '', KES_YOUTUBE_API_KEY: '' },
  })
  const endpoint = { baseUrl: `http://127.0.0.1:${port}/karaoke/`, roomId: 1 }
  const context = await request.newContext()
  servers.push({ process, log, context })
  for (let i = 0; ; i++) {
    if (process.exitCode !== null || i > 240) throw new Error(`Server failed: ${data}/server.log`)
    try {
      if ((await context.get(`${endpoint.baseUrl}api/prefs`)).ok()) break
    } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  for (const [suffix, body] of [['setup', { username: 'admin', name: 'Promotion test', newPassword: 'promotion-test-password', newPasswordConfirm: 'promotion-test-password' }], ['login', { username: 'admin', password: 'promotion-test-password', roomId: 1 }]]) {
    const response = await context.post(`${endpoint.baseUrl}api/${suffix}`, { data: body })
    assert.ok(response.ok(), `${suffix}: ${await response.text()}`)
  }
  const state = await context.storageState()
  const api = await connect(endpoint, state)
  servers.at(-1).api = api
  return { endpoint, state, api }
}

try {
  const source = await start('source')
  const target = await start('target')
  const credentials = { source: source.state, target: target.state }
  const audioPath = path.join(directory, 'fixture.mp3')
  const videoPath = path.join(directory, 'fixture.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:a', 'libmp3lame', audioPath])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', videoPath])
  const audio = await fs.readFile(audioPath)
  const video = await fs.readFile(videoPath)
  const file = { name: 'fixture.mp3', mimeType: 'audio/mpeg', buffer: audio }
  const anonymous = await request.newContext()
  try {
    const denied = await anonymous.post(`${target.endpoint.baseUrl}api/BIRTHDAYS/IMPORT`, { multipart: { metadata: '{}', file } })
    assert.equal(denied.status(), 403)
  } finally { await anonymous.dispose() }
  const voice = await source.api.call('animation/resources/upload', { method: 'POST', multipart: { requestId: 'fixture-audio', kind: 'voice', title: 'Fixture voice', metadata: JSON.stringify({ text: 'Texto aprobado', family: 'manual', modes: ['party'] }), file } })
  assert.equal(voice.preparation, 'ready')
  const background = await source.api.call('animation/background/upload', { method: 'POST', headers: { 'X-Upload-Request-Id': 'fixture-video' }, multipart: { requestId: 'fixture-video', title: 'Fixture background', file: { name: 'fixture.mp4', mimeType: 'video/mp4', buffer: video } } })
  let ready
  for (let i = 0; i < 240; i++) {
    ready = await source.api.call(`animation/background/videos/${background.id}`)
    if (ready.state !== 'preparing') break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.equal(ready.state, 'ready')
  const overview = await source.api.call('animation/background/')
  await source.api.call('animation/background/', { method: 'PUT', data: { ...overview.settings, videoId: ready.id, mode: 'single', dimOpacity: 0.7 } })
  const assets = {}
  for (const kind of ['intro', 'music', 'video']) {
    const bytes = kind === 'video' ? video : audio
    const metadata = { kind, title: `Fixture ${kind}`, checksum: hash(bytes), ...(kind === 'intro' ? { script: 'Texto de introducción aprobado' } : {}) }
    const options = { method: 'POST', multipart: { metadata: JSON.stringify(metadata), file: { name: kind === 'video' ? 'fixture.mp4' : 'fixture.mp3', mimeType: kind === 'video' ? 'video/mp4' : 'audio/mpeg', buffer: bytes } } }
    assets[kind] = await source.api.call('birthdays/import', options)
    assert.equal((await source.api.call('birthdays/import', options)).id, assets[kind].id)
  }
  const birthday = await source.api.call('birthdays/')
  await source.api.call('birthdays/settings', { method: 'PUT', data: { ...birthday.settings, defaultVoiceId: 'Puck', introId: assets.intro.id, introIds: [assets.intro.id], musicId: assets.music.id, videoId: assets.video.id,
    rules: [{ id: 'adult', sex: 'any', minAge: 0, maxAge: 120, voiceId: 'Puck', videoId: assets.video.id, writing: 'Texto aprobado' }] } })
  const manifest = { source: source.endpoint, target: target.endpoint, audio: [voice.id], backgrounds: [ready.id], backgroundSettings: true, birthdays: true }
  const planned = await planPromotion(manifest, path.join(directory, 'bundle'), credentials)
  assert.equal(planned.upload, 5)
  assert.equal((await target.api.call('birthdays/')).assets.length, 0)
  assert.equal((await target.api.call('animation/background/')).videos.length, 0)
  await assert.rejects(applyPromotion(planned.planPath, 'wrong', credentials), /fingerprint/)
  await assert.rejects(applyPromotion(planned.planPath, planned.fingerprint, { target: { cookies: [], origins: [] } }), /HTTP 401|expected room/)
  await assert.rejects(connect({ ...target.endpoint, roomId: 2 }, target.state), /expected room/)
  const result = await applyPromotion(planned.planPath, planned.fingerprint, credentials)
  assert.equal(result.status, 'verified')
  const after = await target.api.call('birthdays/')
  assert.equal(after.assets.length, 3)
  assert.notEqual(after.settings.videoId, assets.video.id)
  assert.equal(after.settings.rules[0].videoId, after.settings.videoId)
  assert.equal(after.settings.rules[0].writing, 'Texto aprobado')
  assert.equal(after.assets.find(item => item.kind === 'intro').script, 'Texto de introducción aprobado')
  assert.equal(after.events.length, 0)
  assert.equal((await target.api.call('animation/history')).length, 0)
  const appliedAgain = await applyPromotion(planned.planPath, planned.fingerprint, credentials)
  assert.deepEqual(appliedAgain.resources, result.resources)
  assert.equal((await target.api.call('birthdays/')).settings.revision, after.settings.revision)

  // A changed target configuration blocks the entire run before new uploads.
  const conflict = await planPromotion(manifest, path.join(directory, 'conflict'), credentials)
  const current = (await target.api.call('animation/background/')).settings
  await target.api.call('animation/background/', { method: 'PUT', data: { ...current, dimOpacity: 0.2 } })
  await assert.rejects(applyPromotion(conflict.planPath, conflict.fingerprint, credentials), /settings changed/)

  // Lost upload response: stable request IDs reconcile without a second resource.
  const audioOnly = await planPromotion({ ...manifest, backgrounds: [], backgroundSettings: false, birthdays: false }, path.join(directory, 'retry'), credentials)
  const first = await applyPromotion(audioOnly.planPath, audioOnly.fingerprint, credentials)
  await writeJSON(first.receiptPath, { fingerprint: audioOnly.fingerprint, resources: {}, settings: {}, status: 'uploading' })
  assert.equal((await applyPromotion(audioOnly.planPath, audioOnly.fingerprint, credentials)).resources[0].id, first.resources[0].id)
  await target.api.call(`animation/resources/${first.resources[0].id}`, { method: 'PATCH', data: { title: 'Operator edit' } })
  await assert.rejects(applyPromotion(audioOnly.planPath, audioOnly.fingerprint, credentials), /metadata changed/)
  const plan = await readJSON(planned.planPath)
  assert.ok(plan.items[0].file)
  await fs.appendFile(path.join(path.dirname(planned.planPath), plan.items[0].file), 'tampered')
  await assert.rejects(applyPromotion(planned.planPath, planned.fingerprint, credentials), /file changed/)
  const badImport = { method: 'POST', multipart: { metadata: JSON.stringify({ kind: 'music', title: 'Invalid checksum', checksum: '0'.repeat(64) }), file } }
  await assert.rejects(target.api.call('birthdays/import', badImport), /HTTP 422/)
  console.log(`PASS two isolated APIs: read-only plan, media/settings mapping, exact scripts, integrity, authentication/room boundaries, drift rejection, retry deduplication, no events or playback. Artifacts: ${directory}`)
} finally {
  for (const server of servers.reverse()) {
    await server.api?.dispose()
    await server.context.dispose()
    if (server.process.exitCode === null && server.process.signalCode === null) {
      const exited = new Promise(resolve => server.process.once('exit', resolve))
      server.process.kill('SIGTERM')
      await exited
    }
    closeSync(server.log)
  }
}
