import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Koa from 'koa'
import { koaBody } from 'koa-body'
import { db, open, close } from '../lib/Database.js'
import { youtubeSongSource } from '../SongSources/YouTubeSongSource.js'
import { createYouTubePlaylistImporter } from './YouTubeImport.js'
import Playlists from './Playlists.js'
import router from './router.js'
import type { ResolvedSong } from '../../shared/songSource.js'
import type { YouTubePlaylistPreview } from '../../shared/youtubePlaylists.js'

const url = 'https://youtube.com/playlist?list=PLfixture00000001'
const songs: ResolvedSong[] = [1, 2].map(id => ({ source: 'YOUTUBE', sourceId: `fixture000${id}`, externalId: `fixture000${id}`, localSongId: null, mediaId: null, mediaType: 'youtube', title: `Song ${id}`, artistOrChannel: 'Artist', thumbnailUrl: null, durationSeconds: 180, isPlayable: true }))
const contents = () => ({ title: 'Music '.repeat(20), songs: structuredClone(songs), omissions: [] })
let directory: string
let base: string
const app = new Koa()
app.use(async (ctx, next) => {
  ctx.user = { isAdmin: ctx.get('test-admin') === 'true', userId: Number(ctx.get('test-user') || 1) } as typeof ctx.user
  await next()
})
app.use(koaBody())
app.use(router.routes())
const server = createServer(app.callback())
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/rooms`
})
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playlist-import-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\'); INSERT INTO users(userId,username,name,password,roleId) VALUES(1,\'admin\',\'Operator\',\'test\',1)')
  vi.spyOn(youtubeSongSource, 'inspectPlaylist').mockImplementation(async () => contents())
})
afterEach(() => {
  vi.restoreAllMocks()
  close()
  fs.rmSync(directory, { recursive: true, force: true })
})
const post = (suffix: string, body: object, admin = true, room = 1, user = 1) => fetch(`${base}/${room}/playlists/import/youtube${suffix}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'test-admin': String(admin), 'test-user': String(user) }, body: JSON.stringify(body),
})

it('authorizes both endpoints and protects the preview owner and room', async () => {
  expect((await post('/preview', { url }, false)).status).toBe(403)
  expect((await post('', { previewId: 'fake', name: 'List' }, false)).status).toBe(403)
  expect(youtubeSongSource.inspectPlaylist).not.toHaveBeenCalled()
  const response = await post('/preview', { url })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const preview = await response.json() as YouTubePlaylistPreview
  expect(preview.suggestedName.length).toBe(80)
  expect(Playlists.snapshot(1).playlists).toHaveLength(0)
  expect((await post('', { previewId: preview.previewId, name: 'Other room' }, true, 2)).status).toBe(410)
  expect((await post('', { previewId: preview.previewId, name: 'Other user' }, true, 1, 2)).status).toBe(410)
  expect((await post('/preview', { url: 'https://example.com' })).status).toBe(422)
})

it('creates once from trusted metadata, persists order and preserves active playback', async () => {
  const existing = Playlists.createFromSongs(1, 'Current', songs)
  Playlists.configure(1, 1, { playlistId: existing, enabled: true, repeat: true })
  Playlists.reconcile(1)
  const queue = db.all('SELECT * FROM queue')
  const playback = Playlists.snapshot(1).playback
  const preview = await (await post('/preview', { url })).json() as YouTubePlaylistPreview
  const body = { previewId: preview.previewId, name: 'Imported', songs: [{ title: 'Untrusted client song' }] }
  const responses = await Promise.all([post('', body), post('', body)])
  expect(responses.map(response => response.status)).toEqual([200, 200])
  const [first, second] = await Promise.all(responses.map(response => response.json()))
  expect(first.createdPlaylistId).toBe(second.createdPlaylistId)
  expect(Playlists.snapshot(1).playlists).toHaveLength(2)
  expect(Playlists.get(1, first.createdPlaylistId).items.map(item => item.song.title)).toEqual(['Song 1', 'Song 2'])
  expect(Playlists.snapshot(1).playback).toEqual(playback)
  expect(db.all('SELECT * FROM queue')).toEqual(queue)
  close()
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  expect(Playlists.get(1, first.createdPlaylistId).items).toHaveLength(2)
})

it('rolls back the entire import on insertion failure and permits the same preview to retry', async () => {
  const importer = createYouTubePlaylistImporter({ inspectPlaylist: async () => contents() })
  const preview = await importer.preview(1, 1, url)
  db.exec('CREATE TRIGGER fail_import BEFORE INSERT ON musicPlaylistItems WHEN NEW.sourceId=\'fixture0002\' BEGIN SELECT RAISE(ABORT,\'fixture failure\'); END')
  expect(() => importer.confirm(1, 1, preview.previewId, 'List')).toThrow('fixture failure')
  expect(Playlists.snapshot(1).playlists).toHaveLength(0)
  expect(db.all('SELECT * FROM musicPlaylistItems')).toHaveLength(0)
  db.exec('DROP TRIGGER fail_import')
  preview.songs[0].title = 'Mutated preview'
  const id = importer.confirm(1, 1, preview.previewId, 'List')
  expect(Playlists.get(1, id).items[0].song.title).toBe('Song 1')
})

it('rechecks capacity and names on confirmation and rejects empty candidates', async () => {
  const importer = createYouTubePlaylistImporter({ inspectPlaylist: async () => contents() })
  const preview = await importer.preview(1, 1, url)
  expect(() => importer.confirm(1, 1, preview.previewId, ' ')).toThrow('nombre')
  for (let i = 0; i < 50; i++) Playlists.create(1, `List ${i}`)
  expect(() => importer.confirm(1, 1, preview.previewId, 'Over capacity')).toThrow('50 listas')
  const empty = createYouTubePlaylistImporter({ inspectPlaylist: async () => ({ title: 'Empty', songs: [], omissions: [] }) })
  const emptyPreview = await empty.preview(2, 1, url)
  expect(() => empty.confirm(2, 1, emptyPreview.previewId, 'Empty')).toThrow('No hay canciones')
  expect(Playlists.snapshot(2).playlists).toHaveLength(0)
})

it('expires previews and rejects confirmations after a service restart', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const source = { inspectPlaylist: async () => contents() }
  const importer = createYouTubePlaylistImporter(source)
  const preview = await importer.preview(1, 1, url)
  expect(() => createYouTubePlaylistImporter(source).confirm(1, 1, preview.previewId, 'List')).toThrow('revisión venció')
  clock.mockReturnValue(preview.expiresAt)
  expect(() => importer.confirm(1, 1, preview.previewId, 'List')).toThrow('revisión venció')
  expect(Playlists.snapshot(1).playlists).toHaveLength(0)
})
