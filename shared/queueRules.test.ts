import { describe, expect, it } from 'vitest'
import {
  getQueuePrefsValidationError,
  normalizeQueuePrefs,
  QUEUE_PREF_DEFAULTS,
} from './queueRules.js'

describe('queue room preferences', () => {
  it('supplies every default for missing preferences', () => {
    expect(normalizeQueuePrefs(undefined)).toEqual(QUEUE_PREF_DEFAULTS)
    expect(normalizeQueuePrefs({})).toEqual(QUEUE_PREF_DEFAULTS)
  })

  it('preserves valid configured values', () => {
    const prefs = {
      maxPendingPerParticipant: 20,
      maxSongsPerParticipantRound: 5,
      houseTracksBeforeParticipant: 0,
      approvalMode: 'MANUAL',
      rotationMode: 'FIFO',
    }

    expect(getQueuePrefsValidationError(prefs)).toBeNull()
    expect(normalizeQueuePrefs(prefs)).toEqual(prefs)
  })

  it.each([
    ['maxPendingPerParticipant', 0, 'El máximo de solicitudes pendientes por participante debe ser un número entero entre 1 y 20'],
    ['maxPendingPerParticipant', 21, 'El máximo de solicitudes pendientes por participante debe ser un número entero entre 1 y 20'],
    ['maxSongsPerParticipantRound', 0, 'El número de canciones por turno de participante debe ser un número entero entre 1 y 5'],
    ['maxSongsPerParticipantRound', 6, 'El número de canciones por turno de participante debe ser un número entero entre 1 y 5'],
    ['houseTracksBeforeParticipant', -1, 'El número de canciones de la casa entre turnos de participantes debe ser un número entero entre 0 y 10'],
    ['houseTracksBeforeParticipant', 11, 'El número de canciones de la casa entre turnos de participantes debe ser un número entero entre 0 y 10'],
    ['houseTracksBeforeParticipant', 1.5, 'El número de canciones de la casa entre turnos de participantes debe ser un número entero entre 0 y 10'],
  ])('rejects an invalid %s value', (key, value, expectedError) => {
    expect(getQueuePrefsValidationError({ [key]: value })).toBe(expectedError)
  })

  it('rejects invalid enum values', () => {
    expect(getQueuePrefsValidationError({ approvalMode: 'SOMETIMES' }))
      .toBe('El modo de aprobación debe ser uno de: AUTO, MANUAL')
    expect(getQueuePrefsValidationError({ rotationMode: 'RANDOM' }))
      .toBe('El orden de reproducción debe ser uno de: FAIR, FIFO')
  })

  it('normalizes invalid stored values without leaking them to clients', () => {
    expect(normalizeQueuePrefs({
      maxPendingPerParticipant: -1,
      maxSongsPerParticipantRound: 99,
      houseTracksBeforeParticipant: 'two',
      approvalMode: 'SOMETIMES',
      rotationMode: 'RANDOM',
    })).toEqual(QUEUE_PREF_DEFAULTS)
  })
})
