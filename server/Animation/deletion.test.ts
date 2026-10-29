import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { loadCatalog, catalogClips, catalogAsset, resourceFile } from './catalog.js'
import { completeResource, createResource, getResource, listResources } from './Resources.js'
import { deleteResource } from './deletion.js'

let directory: string
const metadata = { origin: 'uploaded' as const, text: 'Hola', family: 'turn' as const, modes: ['mixed' as const], automatic: true }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-delete-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'One\',\'open\',\'{}\'),(2,\'Two\',\'open\',\'{}\')')
  await loadCatalog(directory, path.resolve('assets/animation'))
  const original = getResource('demo-welcome')!
  await fs.copyFile(path.join(directory, original.filename!), path.join(directory, 'owned.wav'))
  createResource({ id: 'owned', roomId: 1, title: 'Owned', kind: 'voice', metadata })
  completeResource('owned', { filename: 'owned.wav', mime: original.mime!, checksum: original.checksum!, size: original.size!, durationMs: original.durationMs! })
})
afterEach(async () => {
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

it('removes the file and all inventory views without resurrecting a legacy manifest on restart', async () => {
  await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify([{ id: 'owned', roomId: 1, filename: 'owned.wav', active: true }]))
  deleteResource(1, 'owned')
  expect(getResource('owned')).toBeUndefined()
  expect(listResources(1, { state: 'all' }).items.some(row => row.id === 'owned')).toBe(false)
  expect(listResources(1, {}).counts.voice).toBe(3)
  expect(catalogClips(1).some(row => row.id === 'owned')).toBe(false)
  await expect(resourceFile('owned', 1)).rejects.toThrow('disponible')
  await expect(fs.access(path.join(directory, 'owned.wav'))).rejects.toThrow()
  await loadCatalog(directory)
  expect(getResource('owned')).toBeUndefined()
})

it('rejects foreign resources and an upload still being prepared', () => {
  expect(() => deleteResource(2, 'owned')).toThrow('otra sala')
  db.run('UPDATE audioResources SET preparation=\'preparing\' WHERE id=\'owned\'')
  expect(() => deleteResource(1, 'owned')).toThrow('preparación')
})

it('deletes an included audio only from the requesting room and preserves that choice across restart', async () => {
  deleteResource(1, 'demo-welcome')
  await loadCatalog(directory)
  expect(getResource('demo-welcome', 1)).toBeUndefined()
  expect(catalogAsset('demo-welcome', 1)).toBeUndefined()
  expect(catalogClips(1).some(row => row.id === 'demo-welcome')).toBe(false)
  expect(listResources(1, { state: 'all' }).items.some(row => row.id === 'demo-welcome')).toBe(false)
  expect(listResources(1, {}).counts.voice).toBe(3)
  await expect(resourceFile('demo-welcome', 1)).rejects.toThrow('disponible')
  expect(getResource('demo-welcome', 2)).toBeDefined()
  expect(catalogAsset('demo-welcome', 2)).toBeDefined()
  expect(catalogClips(2).some(row => row.id === 'demo-welcome')).toBe(true)
  await expect(fs.access((await resourceFile('demo-welcome', 2)).file)).resolves.toBeUndefined()
})

it.each(['PENDING', 'RESERVED', 'PLAYING', 'UNCERTAIN'])('protects a secondary asset in a %s intervention', (status) => {
  db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt,leaseUntil,sequenceJSON)
    VALUES('request',1,'request',1,'other','hash','Hola',1000,?,0,?,?,?)`, [status, Date.now() + 10000, Date.now() + 10000, JSON.stringify([{ id: 'other' }, { id: 'owned' }])])
  expect(() => deleteResource(1, 'owned')).toThrow('en uso')
  db.run('UPDATE animationInterventions SET status=\'PLAYED\',leaseUntil=0,startedAt=1 WHERE interventionId=\'request\'')
  deleteResource(1, 'owned')
  expect(db.get('SELECT interventionId FROM animationInterventions WHERE startedAt=1')).toBeTruthy()
})

it('protects current ambience and lets the operator delete after it stops', () => {
  db.run('INSERT INTO animationRoomState(roomId,ambienceJSON) VALUES(1,?)', [JSON.stringify({ clip: { id: 'owned' }, until: Date.now() + 10000 })])
  expect(() => deleteResource(1, 'owned')).toThrow('en uso')
  db.run('UPDATE animationRoomState SET ambienceJSON=NULL WHERE roomId=1')
  expect(() => deleteResource(1, 'owned')).not.toThrow()
})

it('retains bytes referenced by another room', async () => {
  const own = getResource('owned')!
  createResource({ id: 'other-room', roomId: 2, title: 'Shared file', kind: 'voice', metadata })
  completeResource('other-room', { filename: own.filename!, mime: own.mime!, checksum: own.checksum!, size: own.size!, durationMs: own.durationMs! })
  deleteResource(1, 'owned')
  expect((await resourceFile('other-room', 2)).file).toBe(path.join(directory, 'owned.wav'))
  await expect(fs.access(path.join(directory, 'owned.wav'))).resolves.toBeUndefined()
})

it('allows removal of a missing file but refuses a path outside the catalog', async () => {
  db.run('UPDATE audioResources SET filename=\'../outside.wav\' WHERE id=\'owned\'')
  expect(() => deleteResource(1, 'owned')).toThrow('fuera')
  db.run('UPDATE audioResources SET filename=\'owned.wav\' WHERE id=\'owned\'')
  await fs.unlink(path.join(directory, 'owned.wav'))
  expect(() => deleteResource(1, 'owned')).not.toThrow()
})
