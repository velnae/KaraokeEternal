import { expect, it, vi } from 'vitest'
import type { AnimationSnapshot, Intervention } from '../../shared/animation'
import { AnimationReceiptTimeout, confirmPlaybackReceipt, hasConfirmedPlayback } from './animationPlaybackReceipt'

const grant = { interventionId: 'voice-1', roomId: 1, playerEpoch: 4, ownerSocketId: 'player-1', leaseUntil: 9000 } as Intervention
const snapshot = (patch: Partial<Intervention> = {}) => ({ roomId: 1, playerEpoch: 4,
  active: { ...grant, status: 'PLAYING', stopRequestedAt: null, ...patch } } as AnimationSnapshot)

it('keeps an accepted voice running when only its acknowledgment times out', async () => {
  const send = vi.fn().mockRejectedValue(new AnimationReceiptTimeout('late receipt'))
  await expect(confirmPlaybackReceipt(send, () => hasConfirmedPlayback(snapshot(), grant, 'player-1', 2000))).resolves.toBe('confirmed-state')
  expect(send).toHaveBeenCalledTimes(1)
})

it('does not treat a rejected start as confirmed even if a snapshot says PLAYING', async () => {
  const rejection = new Error('El permiso de inicio venció')
  await expect(confirmPlaybackReceipt(async () => {
    throw rejection
  }, () => true)).rejects.toBe(rejection)
})

it('stops on a missing confirmation when the grant was not started, revoked, replaced or expired', async () => {
  const timeout = new AnimationReceiptTimeout('late receipt')
  for (const patch of [
    { status: 'RESERVED' }, { status: 'INTERRUPTED' }, { stopRequestedAt: 1000 },
    { interventionId: 'another' }, { playerEpoch: 5 }, { ownerSocketId: 'another' }, { leaseUntil: 1999 },
  ] as Array<Partial<Intervention>>) {
    await expect(confirmPlaybackReceipt(async () => {
      throw timeout
    },
    () => hasConfirmedPlayback(snapshot(patch), grant, 'player-1', 2000))).rejects.toBe(timeout)
  }
  expect(hasConfirmedPlayback(null, grant, 'player-1', 2000)).toBe(false)
  expect(hasConfirmedPlayback(snapshot(), grant, undefined, 2000)).toBe(false)
  expect(hasConfirmedPlayback(snapshot(), grant, 'new-socket', 2000)).toBe(false)
  expect(hasConfirmedPlayback({ ...snapshot(), roomId: 2 }, grant, 'player-1', 2000)).toBe(false)
  expect(hasConfirmedPlayback(snapshot(), { ...grant, leaseUntil: 1999 }, 'player-1', 2000)).toBe(false)
})

it('accepts a normal receipt without a fallback or retry', async () => {
  const confirmed = vi.fn(() => false)
  await expect(confirmPlaybackReceipt(async () => ({}), confirmed)).resolves.toBe('acknowledged')
  expect(confirmed).not.toHaveBeenCalled()
})
