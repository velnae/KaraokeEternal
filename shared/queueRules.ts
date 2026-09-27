export const APPROVAL_MODES = ['AUTO', 'MANUAL'] as const
export const ROTATION_MODES = ['FAIR', 'FIFO'] as const

export type ApprovalMode = typeof APPROVAL_MODES[number]
export type RotationMode = typeof ROTATION_MODES[number]

export interface QueuePrefs {
  maxPendingPerParticipant: number
  maxSongsPerParticipantRound: number
  houseTracksBeforeParticipant: number
  approvalMode: ApprovalMode
  rotationMode: RotationMode
}

export const QUEUE_PREF_DEFAULTS: Readonly<QueuePrefs> = Object.freeze({
  maxPendingPerParticipant: 2,
  maxSongsPerParticipantRound: 1,
  houseTracksBeforeParticipant: 2,
  approvalMode: 'AUTO',
  rotationMode: 'FAIR',
})

export const QUEUE_PREF_LIMITS = Object.freeze({
  maxPendingPerParticipant: Object.freeze({ min: 1, max: 20 }),
  maxSongsPerParticipantRound: Object.freeze({ min: 1, max: 5 }),
  houseTracksBeforeParticipant: Object.freeze({ min: 0, max: 10 }),
})

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isIntegerInRange = (value: unknown, min: number, max: number): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

const isApprovalMode = (value: unknown): value is ApprovalMode => {
  return typeof value === 'string' && APPROVAL_MODES.includes(value as ApprovalMode)
}

const isRotationMode = (value: unknown): value is RotationMode => {
  return typeof value === 'string' && ROTATION_MODES.includes(value as RotationMode)
}

export const getQueuePrefsValidationError = (value: unknown): string | null => {
  if (typeof value === 'undefined' || value === null) return null
  if (!isRecord(value)) return 'Queue preferences must be an object'

  for (const key of Object.keys(QUEUE_PREF_LIMITS) as Array<keyof typeof QUEUE_PREF_LIMITS>) {
    const candidate = value[key]
    if (typeof candidate === 'undefined') continue

    const { min, max } = QUEUE_PREF_LIMITS[key]
    if (!isIntegerInRange(candidate, min, max)) {
      return `${key} must be an integer between ${min} and ${max}`
    }
  }

  if (typeof value.approvalMode !== 'undefined' && !isApprovalMode(value.approvalMode)) {
    return `approvalMode must be one of: ${APPROVAL_MODES.join(', ')}`
  }

  if (typeof value.rotationMode !== 'undefined' && !isRotationMode(value.rotationMode)) {
    return `rotationMode must be one of: ${ROTATION_MODES.join(', ')}`
  }

  return null
}

export const normalizeQueuePrefs = (value: unknown): QueuePrefs => {
  const prefs = isRecord(value) ? value : {}
  const pendingLimits = QUEUE_PREF_LIMITS.maxPendingPerParticipant
  const roundLimits = QUEUE_PREF_LIMITS.maxSongsPerParticipantRound
  const houseLimits = QUEUE_PREF_LIMITS.houseTracksBeforeParticipant

  return {
    maxPendingPerParticipant: isIntegerInRange(
      prefs.maxPendingPerParticipant,
      pendingLimits.min,
      pendingLimits.max,
    )
      ? prefs.maxPendingPerParticipant
      : QUEUE_PREF_DEFAULTS.maxPendingPerParticipant,
    maxSongsPerParticipantRound: isIntegerInRange(
      prefs.maxSongsPerParticipantRound,
      roundLimits.min,
      roundLimits.max,
    )
      ? prefs.maxSongsPerParticipantRound
      : QUEUE_PREF_DEFAULTS.maxSongsPerParticipantRound,
    houseTracksBeforeParticipant: isIntegerInRange(
      prefs.houseTracksBeforeParticipant,
      houseLimits.min,
      houseLimits.max,
    )
      ? prefs.houseTracksBeforeParticipant
      : QUEUE_PREF_DEFAULTS.houseTracksBeforeParticipant,
    approvalMode: isApprovalMode(prefs.approvalMode)
      ? prefs.approvalMode
      : QUEUE_PREF_DEFAULTS.approvalMode,
    rotationMode: isRotationMode(prefs.rotationMode)
      ? prefs.rotationMode
      : QUEUE_PREF_DEFAULTS.rotationMode,
  }
}
