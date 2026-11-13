import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { close, db, open } from '../../lib/Database.js'
import Queue from '../../Queue/Queue.js'
import * as transition from '../../Greetings/transition.js'
import { sceneExample, sceneExamples } from './examples.js'

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-examples-'))
  open({ file: path.join(directory, 'database.sqlite3'), ro: false })
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\'); INSERT INTO users(userId,username,password,name,roleId) VALUES(1,\'ana\',\'\',\'Ana\',1)')
})
afterEach(() => {
  close()
  fs.rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
function add (roomId: number) {
  return Queue.add({ roomId, userId: 1, requestIntent: 'LISTEN', song: { source: 'YOUTUBE', sourceId: 'fixture0001', externalId: 'fixture0001', localSongId: null,
    mediaId: null, mediaType: 'youtube', title: 'Test song', artistOrChannel: 'Fixture', durationSeconds: 120, thumbnailUrl: null, isPlayable: true } })
}
it('lists and resolves only the current room without a public reservation or usage receipt', async () => {
  const own = add(1)
  const foreign = add(2)
  const prepare = vi.spyOn(transition, 'prepareGreetingTransition').mockResolvedValue(null)
  expect(sceneExamples(1).map(example => example.id)).toEqual([`queue:${own}`])
  await expect(sceneExample(1, `queue:${foreign}`)).rejects.toThrow('sala')
  expect(prepare).not.toHaveBeenCalled()
  const example = await sceneExample(1, `queue:${own}`)
  expect(example.values).toMatchObject({ name: 'Ana', song: 'Test song' })
  expect(example.resources).toEqual({})
  expect(prepare).toHaveBeenCalledWith(1, own)
  expect(db.get<{ count: number }>('SELECT count(*) count FROM animationInterventions')!.count).toBe(0)
  expect(db.get<{ count: number }>('SELECT count(*) count FROM audioUsage')!.count).toBe(0)
})
