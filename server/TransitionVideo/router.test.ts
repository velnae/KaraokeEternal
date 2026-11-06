import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import Koa from 'koa'
import Router from '@koa/router'
import koaRange from 'koa-range'
import { koaBody } from 'koa-body'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { createTransitionVideoRouter, isTransitionVideoPath } from './router.js'
import { TransitionVideoService, type VideoServiceOptions } from './Service.js'
import { createTransitionVideo, getTransitionVideo, getTransitionVideoAttempt, getTransitionVideoSettings } from './Store.js'
import { videoFixture } from './fixtures.js'

let fixtures: string
let bytes: Buffer
let directory: string
let service: TransitionVideoService
let server: Server
let base: string
const emit = vi.fn()
const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }
const api = (suffix: string, options: RequestInit = {}, identity = 'admin') => fetch(base + suffix, {
  ...options, headers: { 'X-Test-User': identity, ...options.headers },
})
const upload = (id: string, data = bytes, identity = 'admin') => {
  const form = new FormData()
  form.append('requestId', id)
  form.append('title', 'Fondo de prueba')
  form.append('file', new Blob([new Uint8Array(data)]), 'video.mp4')
  return api('/upload', { method: 'POST', body: form }, identity)
}
const ready = async (id: string) => {
  const response = await upload(id)
  expect(response.status).toBe(202)
  const video = await response.json()
  await expect.poll(() => getTransitionVideo(1, video.id)?.state, { timeout: 10_000 }).toBe('ready')
  await expect.poll(() => service.capability().busy).toBe(false)
  return video.id as string
}
const save = (videoId: string | null, revision = 0) => api('/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId, dimOpacity: 0.6, revision }) })
const restart = async (options: Partial<VideoServiceOptions> = {}) => {
  await service.stop()
  service = new TransitionVideoService(path.join(directory, 'video'), { ...tools, ...options })
  await service.start()
}
const waitForAbort: NonNullable<VideoServiceOptions['prepare']> = async (_directory, _tools, signal) => {
  await new Promise<void>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  throw new Error('Unreachable')
}

beforeAll(async () => {
  fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'video-http-fixtures-'))
  bytes = await fs.readFile(await videoFixture(fixtures))
})
afterAll(async () => {
  await fs.rm(fixtures, { recursive: true, force: true })
})
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-http-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
  service = new TransitionVideoService(path.join(directory, 'video'), tools)
  await service.start()
  emit.mockClear()
  const app = new Koa()
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      ctx.status = (error as { status?: number }).status || 500
      ctx.body = (error as Error).message
    }
  })
  app.use((ctx, next) => isTransitionVideoPath(ctx.path, '/karaoke/') ? next() : koaRange(ctx, next))
  app.use(async (ctx, next) => {
    const identity = ctx.get('X-Test-User')
    ctx.user = { isAdmin: ['admin', 'foreign'].includes(identity), roomId: identity === 'foreign' ? 2 : identity === 'anonymous' ? null : 1 }
    ctx.io = { in: () => ({ fetchSockets: async () => [{ id: 'admin', user: { isAdmin: true } }, { id: 'guest', user: { isAdmin: false } }] }),
      to: (id: string) => ({ emit: (...args: unknown[]) => emit(id, ...args) }) }
    await next()
  })
  await fs.mkdir(path.join(directory, 'legacy-upload'))
  const parseBody = koaBody({ multipart: true, formidable: { uploadDir: path.join(directory, 'legacy-upload') } })
  app.use((ctx, next) => isTransitionVideoPath(ctx.path, '/karaoke/') ? next() : parseBody(ctx, next))
  const router = new Router({ prefix: '/karaoke' })
  router.use(createTransitionVideoRouter(() => service).routes())
  app.use(router.routes())
  server = createServer(app.callback())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/karaoke/api/animation/background`
})
afterEach(async () => {
  await service.stop()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

it('authenticates before storing multipart data and before processing ranges', async () => {
  for (const identity of ['anonymous', 'participant']) {
    expect((await upload('blocked', bytes, identity)).status).toBe(403)
    expect((await api('/', { headers: { Range: 'bytes=0-3' } }, identity)).status).toBe(403)
    expect((await api('/', { method: 'PUT', body: 'malformed' }, identity)).status).toBe(403)
  }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), 'unauthorized.mp4')
  const alias = base.replace('/karaoke/api/animation/background', '/KARAOKE/API/ANIMATION/BACKGROUND')
  expect((await fetch(alias + '/upload', { method: 'POST', headers: { 'X-Test-User': 'anonymous' }, body: form })).status).toBe(403)
  expect(await fs.readdir(path.join(directory, 'legacy-upload'))).toEqual([])
  expect(await fs.readdir(service.staging)).toEqual([])
  expect(db.get<{ count: number }>('SELECT count(*) count FROM transitionVideos')!.count).toBe(0)
})

it('uploads, polls, saves, broadcasts only to admins and streams silent real media under a URL prefix', async () => {
  const id = await ready('real')
  const response = await save(id)
  expect(response.status).toBe(200)
  expect((await response.json()).settings).toMatchObject({ videoId: id, revision: 1 })
  expect(emit).toHaveBeenCalledOnce()
  expect(emit.mock.calls[0][0]).toBe('admin')
  const video = await api(`/videos/${id}/video`)
  expect(video.status).toBe(200)
  expect(video.headers.get('content-type')).toContain('video/mp4')
  expect(Buffer.from(await video.arrayBuffer())).toEqual(await fs.readFile(path.join(service.directory, `${id}.mp4`)))
  const poster = await api(`/videos/${id}/poster`)
  expect(poster.status).toBe(200)
  expect(Buffer.from(await poster.arrayBuffer()).readUInt16BE(0)).toBe(0xffd8)
  expect(await fs.readdir(service.staging)).toEqual([])
  await restart()
  expect((await (await api('/')).json()).selected.id).toBe(id)
})

it('serves exact ranges, suffixes, clipped ends and HEAD without global middleware interference', async () => {
  const id = await ready('ranges')
  const file = await fs.readFile(path.join(service.directory, `${id}.mp4`))
  for (const [range, start, end] of [['bytes=0-7', 0, 7], ['bytes=-8', file.length - 8, file.length - 1], [`bytes=${file.length - 8}-`, file.length - 8, file.length - 1], [`bytes=0-${file.length + 100}`, 0, file.length - 1]] as const) {
    const result = await api(`/videos/${id}/video`, { headers: { Range: range } })
    expect(result.status).toBe(206)
    expect(result.headers.get('content-range')).toBe(`bytes ${start}-${end}/${file.length}`)
    expect(Number(result.headers.get('content-length'))).toBe(end - start + 1)
    expect(Buffer.from(await result.arrayBuffer())).toEqual(file.subarray(start, end + 1))
  }
  const invalid = await api(`/videos/${id}/video`, { headers: { Range: `bytes=${file.length}-` } })
  expect(invalid.status).toBe(416)
  expect(invalid.headers.get('content-range')).toBe(`bytes */${file.length}`)
  const head = await api(`/videos/${id}/video`, { method: 'HEAD', headers: { Range: 'bytes=0-7' } })
  expect(head.status).toBe(200)
  expect(Number(head.headers.get('content-length'))).toBe(file.length)
  expect((await head.arrayBuffer()).byteLength).toBe(0)
  expect((await api(`/videos/${id}/video`, { headers: { 'Range': 'bytes=0-7', 'If-Range': '"old"' } })).status).toBe(200)
})

it('rejects cross-room reads/selection and stale settings saves', async () => {
  const id = await ready('private')
  for (const suffix of ['', '/video', '/poster']) expect((await api(`/videos/${id}${suffix}`, {}, 'foreign')).status).toBe(404)
  const foreign = await api('/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: id, dimOpacity: 0.55, revision: 0 }) }, 'foreign')
  expect(foreign.status).toBe(422)
  const results = await Promise.all([save(id), save(null)])
  expect(results.map(result => result.status).sort()).toEqual([200, 409])
})

it('accepts promptly, deduplicates during preparation and rejects a second job instead of queueing', async () => {
  const previous = await ready('old-candidate')
  await restart({ prepare: waitForAbort })
  const first = await upload('slow')
  expect(first.status).toBe(202)
  const row = await first.json()
  expect(row.state).toBe('preparing')
  const duplicate = await api('/upload', { method: 'POST', headers: { 'X-Upload-Request-Id': 'slow' } })
  expect(duplicate.status).toBe(202)
  expect((await duplicate.json()).id).toBe(row.id)
  expect((await upload('second')).status).toBe(409)
  expect(db.get<{ count: number }>('SELECT count(*) count FROM transitionVideos')!.count).toBe(2)
  await service.cleanup()
  expect(getTransitionVideo(1, previous)?.state).toBe('ready')
  await expect(fs.stat(path.join(service.directory, `${previous}.mp4`))).resolves.toBeDefined()
  await service.stop()
  expect(getTransitionVideo(1, row.id)?.state).toBe('failed')
  expect(await fs.readdir(service.staging)).toEqual([])
})

it('bounds preparation time and leaves a failed receipt for retry recovery', async () => {
  await restart({ prepare: waitForAbort, preparationTimeoutMs: 30 })
  const row = await (await upload('deadline')).json()
  await expect.poll(() => getTransitionVideo(1, row.id)?.state).toBe('failed')
  expect(getTransitionVideo(1, row.id)?.reason).toContain('tiempo permitido')
  expect((await (await api('/upload', { method: 'POST', headers: { 'X-Upload-Request-Id': 'deadline' } })).json()).id).toBe(row.id)
})

it('keeps the previous background usable after malformed replacement input', async () => {
  const selected = await ready('selected')
  await save(selected)
  const bad = await (await upload('bad', Buffer.from('not a video'))).json()
  await expect.poll(() => getTransitionVideo(1, bad.id)?.state).toBe('failed')
  expect(getTransitionVideoSettings(1).videoId).toBe(selected)
  expect((await api(`/videos/${selected}/video`)).status).toBe(200)
  expect((await save(bad.id, 1)).status).toBe(422)
})

it('retains the full catalog and defers explicit deletion until readers finish', async () => {
  const selected = await ready('selected')
  await save(selected)
  const previous = await ready('previous')
  const reading = service.acquire(1, previous)
  const latest = await ready('latest')
  expect((await (await api('/')).json()).videos).toHaveLength(3)
  expect(getTransitionVideo(1, previous)?.state).toBe('ready')
  expect((await api(`/videos/${previous}`, { method: 'DELETE' })).status).toBe(200)
  await expect(fs.stat(path.join(service.directory, `${previous}.mp4`))).resolves.toBeDefined()
  reading.release()
  await service.cleanup()
  expect(getTransitionVideo(1, previous)).toBeUndefined()
  await expect(fs.stat(path.join(service.directory, `${previous}.mp4`))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(getTransitionVideo(1, selected)?.state).toBe('ready')
  expect(getTransitionVideo(1, latest)?.state).toBe('ready')
  const duplicate = await (await api('/upload', { method: 'POST', headers: { 'X-Upload-Request-Id': 'previous' } })).json()
  expect(duplicate).toMatchObject({ id: previous, state: 'failed', videoUrl: null })
  expect(getTransitionVideoAttempt(1, 'previous')?.retiredAt).toBeTruthy()
}, 15_000)

it('activates only prepared own-room videos and preserves inactive files', async () => {
  const id = await ready('activation')
  expect((await (await api(`/videos/${id}`)).json()).active).toBe(false)
  const options = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) }
  expect((await api(`/videos/${id}`, options, 'anonymous')).status).toBe(403)
  expect((await api(`/videos/${id}`, options, 'foreign')).status).toBe(422)
  expect((await api(`/videos/${id}`, options)).status).toBe(200)
  expect((await (await api(`/videos/${id}`)).json()).active).toBe(true)
  expect((await api(`/videos/${id}`, { ...options, body: JSON.stringify({ active: false }) })).status).toBe(200)
  await restart()
  expect((await (await api('/')).json()).videos).toHaveLength(1)
  expect((await api(`/videos/${id}/video`)).status).toBe(200)
})

it('recovers incomplete work and orphaned files after restart without losing selected media', async () => {
  const selected = await ready('selected')
  await save(selected)
  await service.stop()
  const pending = createTransitionVideo(1, { requestId: 'interrupted', title: 'Interrupted' })
  await fs.mkdir(path.join(service.staging, pending.id))
  await fs.writeFile(path.join(service.staging, pending.id, 'source.mp4'), bytes)
  await fs.writeFile(path.join(service.directory, `${pending.id}.mp4`), bytes)
  await restart()
  expect(getTransitionVideo(1, pending.id)?.state).toBe('failed')
  expect(await fs.readdir(service.staging)).toEqual([])
  await expect(fs.stat(path.join(service.directory, `${pending.id}.mp4`))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await api(`/videos/${selected}/video`)).status).toBe(200)
})

it('removes a partially published derivative when poster publication fails', async () => {
  const selected = await ready('selected')
  await save(selected)
  await restart({ prepare: async (work) => {
    await fs.writeFile(path.join(work, 'video.mp4'), bytes)
    return { durationMs: 1000, width: 320, height: 180, frameRate: 10, size: bytes.length, checksum: 'a'.repeat(64) }
  } })
  const failed = await (await upload('partial-publication')).json()
  await expect.poll(() => service.capability().busy).toBe(false)
  expect(getTransitionVideo(1, failed.id)?.state).toBe('failed')
  await expect(fs.stat(path.join(service.directory, `${failed.id}.mp4`))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(getTransitionVideoSettings(1).videoId).toBe(selected)
  expect(await fs.readdir(service.staging)).toEqual([])
})

it('reports missing tools explicitly while existing selected files remain accessible', async () => {
  const selected = await ready('selected')
  await save(selected)
  await restart({ ffprobe: '/missing/ffprobe' })
  expect((await (await api('/')).json()).capability).toMatchObject({ available: false, reason: expect.stringContaining('FFprobe') })
  expect((await upload('unavailable')).status).toBe(503)
  expect((await api(`/videos/${selected}/video`)).status).toBe(200)
})

it('cleans parser files on file-count/field errors and invalid upload metadata', async () => {
  const form = new FormData()
  form.append('requestId', 'too-many')
  form.append('file', new Blob([new Uint8Array(bytes)]), 'first.mp4')
  form.append('file', new Blob([new Uint8Array(bytes)]), 'second.mp4')
  expect((await api('/upload', { method: 'POST', body: form })).status).toBe(413)
  expect((await upload('../invalid')).status).toBe(422)
  expect(await fs.readdir(service.staging)).toEqual([])
  expect(db.get<{ count: number }>('SELECT count(*) count FROM transitionVideos')!.count).toBe(0)
  expect(service.capability().busy).toBe(false)
})

it('enforces the file limit during a chunked multipart upload and removes partial files', async () => {
  const boundary = 'video-size-test'
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(base + '/upload', { method: 'POST', headers: { 'X-Test-User': 'admin', 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode!))
    })
    req.on('error', reject)
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.mp4"\r\nContent-Type: video/mp4\r\n\r\n`)
    req.end(Buffer.concat([Buffer.alloc(40 * 1024 * 1024 + 1), Buffer.from(`\r\n--${boundary}--\r\n`)]))
  })
  expect(status).toBe(413)
  await expect.poll(async () => (await fs.readdir(service.staging)).length).toBe(0)
  expect(service.capability().busy).toBe(false)
}, 15_000)

it.each(['disconnect', 'shutdown'])('cancels multipart uploads and releases storage/admission on %s', async (action) => {
  const boundary = 'video-abort-test'
  const req = request(base + '/upload', { method: 'POST', headers: { 'X-Test-User': 'admin', 'Content-Type': `multipart/form-data; boundary=${boundary}` } })
  req.on('error', () => {})
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.mp4"\r\nContent-Type: video/mp4\r\n\r\n`)
  req.write(bytes)
  await expect.poll(async () => (await fs.readdir(service.staging)).length).toBe(1)
  if (action === 'disconnect') req.destroy()
  else await service.stop()
  await expect.poll(() => service.capability().busy).toBe(false)
  expect(await fs.readdir(service.staging)).toEqual([])
  expect(db.get<{ count: number }>('SELECT count(*) count FROM transitionVideos')!.count).toBe(0)
})
