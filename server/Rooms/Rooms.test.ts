import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { close, db, open } from '../lib/Database.js'
import { ValidationError } from '../lib/Errors.js'
import Rooms from './Rooms.js'
import crypto from '../lib/crypto.js'
import { createTransitionVideo, completeTransitionVideo, getTransitionVideoSettings, saveTransitionVideoSettings } from '../TransitionVideo/Store.js'
import { TRANSITION_VIDEO_PREF_DEFAULTS } from '../../shared/transitionVideo.js'

describe('Rooms preferences', () => {
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

  it('starts new and legacy rooms unselected even when a generic create supplies a background', async () => {
    const { lastID } = await Rooms.set(undefined, {
      name: 'Video room', status: 'open',
      prefs: { transitionVideo: { videoId: 'unverified', dimOpacity: 0.8, revision: 99 } },
    })
    const roomId = Number(lastID)
    expect(Rooms.get(roomId).entities[roomId].prefs.transitionVideo).toEqual(TRANSITION_VIDEO_PREF_DEFAULTS)
    expect(getTransitionVideoSettings(roomId)).toEqual(TRANSITION_VIDEO_PREF_DEFAULTS)
    db.run('UPDATE rooms SET data=\'{}\' WHERE roomId=?', [roomId])
    expect(Rooms.get(roomId).entities[roomId].prefs.transitionVideo).toEqual(TRANSITION_VIDEO_PREF_DEFAULTS)
  })

  it('preserves a ready selection through stale, omitted and forged generic room preferences', async () => {
    const { lastID } = await Rooms.set(undefined, { name: 'Selected background', status: 'open', prefs: {} })
    const roomId = Number(lastID)
    const video = createTransitionVideo(roomId, { requestId: 'selection', title: 'Fondo' })
    completeTransitionVideo(roomId, video.id, { durationMs: 1000, width: 640, height: 360, frameRate: 24, size: 2048, checksum: 'a'.repeat(64) })
    const selected = saveTransitionVideoSettings(roomId, { videoId: video.id, dimOpacity: 0.65, revision: 0 })
    const stalePrefs = [undefined, {}, { transitionVideo: { ...TRANSITION_VIDEO_PREF_DEFAULTS } }, { transitionVideo: { videoId: 'foreign', dimOpacity: 0, revision: 999 } }]
    for (const prefs of stalePrefs) {
      await Rooms.set(roomId, { name: 'Edited room', status: 'open', prefs })
      expect(getTransitionVideoSettings(roomId)).toEqual(selected)
      expect(Rooms.get(roomId).entities[roomId].prefs.transitionVideo).toEqual(selected)
    }
  })

  it('preserves a background save that occurs while a room password hash is pending', async () => {
    const { lastID } = await Rooms.set(undefined, { name: 'Concurrent room', status: 'open', prefs: {} })
    const roomId = Number(lastID)
    const staleRoom = Rooms.get(roomId).entities[roomId]
    let releaseHash!: (hash: string) => void
    const hash = vi.spyOn(crypto, 'hash').mockImplementation(() => new Promise((resolve) => {
      releaseHash = resolve
    }))
    try {
      const editing = Rooms.set(roomId, { ...staleRoom, password: 'new-password' })
      expect(hash).toHaveBeenCalledOnce()
      const saved = saveTransitionVideoSettings(roomId, { videoId: null, dimOpacity: 0.8, revision: 0 })
      releaseHash('hashed-password')
      await editing
      expect(getTransitionVideoSettings(roomId)).toEqual(saved)
    } finally {
      hash.mockRestore()
    }
  })
})
