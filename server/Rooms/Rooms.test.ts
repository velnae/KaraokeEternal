import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import Rooms from './Rooms.js'

describe('Rooms queue preferences', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-eternal-rooms-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
  })

  afterAll(() => {
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('persists and retrieves valid queue settings per room', async () => {
    await Rooms.set(undefined, {
      name: 'Pilot room',
      status: 'open',
      prefs: {
        queue: {
          maxPendingPerParticipant: 8,
          maxSongsPerParticipantRound: 3,
          houseTracksBeforeParticipant: 4,
          approvalMode: 'MANUAL',
          rotationMode: 'FIFO',
        },
      },
    })

    const rooms = Rooms.get()
    const room = rooms.entities[rooms.result[0]]

    expect(room.prefs.queue).toEqual({
      maxPendingPerParticipant: 8,
      maxSongsPerParticipantRound: 3,
      houseTracksBeforeParticipant: 4,
      approvalMode: 'MANUAL',
      rotationMode: 'FIFO',
    })
  })

  it('adds queue defaults when a legacy room has no queue settings', async () => {
    await Rooms.set(undefined, {
      name: 'Legacy room',
      status: 'open',
      prefs: {},
    })

    const roomId = Rooms.get().result[0]
    db.run('UPDATE rooms SET data = ? WHERE roomId = ?', [JSON.stringify({ prefs: {} }), roomId])

    expect(Rooms.get(roomId).entities[roomId].prefs.queue).toEqual({
      maxPendingPerParticipant: 2,
      maxSongsPerParticipantRound: 1,
      houseTracksBeforeParticipant: 2,
      approvalMode: 'AUTO',
      rotationMode: 'FAIR',
    })
  })

  it('rejects invalid queue settings before persistence', async () => {
    await expect(Rooms.set(undefined, {
      name: 'Invalid room',
      status: 'open',
      prefs: {
        queue: {
          maxPendingPerParticipant: 0,
        },
      },
    })).rejects.toThrowError(new ValidationError(
      'El máximo de solicitudes pendientes por participante debe ser un número entero entre 1 y 20',
    ))
  })

  it('reports invalid room names in Spanish without changing stored room status values', async () => {
    await expect(Rooms.set(undefined, {
      name: '',
      status: 'open',
      prefs: {},
    })).rejects.toThrow('El nombre de la sala debe tener entre 1 y 50 caracteres')

    const result = await Rooms.set(undefined, {
      name: 'Singer room',
      status: 'closed',
      prefs: {},
    })
    expect(Rooms.get(result.lastID, { status: ['open', 'closed'] }).entities[result.lastID].status).toBe('closed')
  })
})
