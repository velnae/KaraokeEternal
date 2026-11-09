import type { AnimationSnapshot, Intervention } from '../../shared/animation'

export class AnimationReceiptTimeout extends Error {}

// A missing receipt is not a rejection. Only an already-confirmed, live grant
// can stand in for it; RESERVED alone never proves the server accepted STARTED.
export function hasConfirmedPlayback (snapshot: AnimationSnapshot | null, grant: Intervention, socketId: string | undefined, now: number) {
  const active = snapshot?.active
  return !!socketId && snapshot?.roomId === grant.roomId && snapshot.playerEpoch === grant.playerEpoch
    && active?.interventionId === grant.interventionId && active.status === 'PLAYING'
    && active.playerEpoch === grant.playerEpoch && active.ownerSocketId === socketId
    && grant.ownerSocketId === socketId && !active.stopRequestedAt
    && (active.leaseUntil ?? 0) > now && (grant.leaseUntil ?? 0) > now
}

export async function confirmPlaybackReceipt (send: () => Promise<unknown>, confirmed: () => boolean) {
  try {
    await send()
    return 'acknowledged' as const
  } catch (error) {
    if (!(error instanceof AnimationReceiptTimeout) || !confirmed()) throw error
    return 'confirmed-state' as const
  }
}
