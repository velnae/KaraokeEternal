import type { Intervention } from '../../../../../shared/animation.js'

export function hasLocalPlaybackProof (
  intervention: Pick<Intervention, 'ownerSocketId' | 'interventionId'> | undefined,
  socketId: string | undefined,
  settled: ReadonlySet<string>,
): boolean {
  // Two missing identities are not proof that this tab owns a reservation.
  return !!intervention && !!socketId && intervention.ownerSocketId === socketId
    && settled.has(intervention.interventionId)
}
