import socket from './socket'
import { canOperate } from 'shared/permissions'
import store from 'store/store'
import { ANIMATION_SYNC, ANIMATION_STATE, ANIMATION_DISCONNECTED, ANIMATION_EVENT, ANIMATION_LIMITS, type AnimationReply, type AnimationClip, type Intervention } from 'shared/animation'
import HttpApi from './HttpApi'
import { AnimationReceiptTimeout, confirmPlaybackReceipt, hasConfirmedPlayback } from './animationPlaybackReceipt'
import { tracePlayback } from './playbackTrace'

export function animationTime () {
  const { snapshot, receivedAt } = store.getState().animation
  return snapshot ? snapshot.serverTime + Date.now() - receivedAt : Date.now()
}

export function animationRequest (type: string, payload: object = {}, timeout = 2000): Promise<AnimationReply> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Sin conexión. La orden no se envió.'))
    const socketId = socket.id
    // The snapshot clock excludes inbound transit time. Keep command validity
    // separate from the caller's receipt timeout so normal RTT cannot expire it.
    socket.timeout(timeout).emit('action', { type, payload: { ...payload, expiresAt: animationTime() + Math.max(timeout, ANIMATION_LIMITS.startMs) } }, (error: Error | null, reply: AnimationReply) => {
      if (socket.id !== socketId) return reject(new Error('Sin confirmación. Consulte el estado antes de repetir.'))
      if (error) return reject(new AnimationReceiptTimeout('Sin confirmación. Consulte el estado antes de repetir.'))
      if (reply?.payload) store.dispatch({ type: ANIMATION_STATE, payload: reply.payload })
      if (reply?.error) return reject(new Error(reply.error))
      resolve(reply)
    })
  })
}

export async function animationPlaybackEvent (grant: Intervention, event: 'STARTED' | 'ASSET_STARTED', clipId?: string) {
  const result = await confirmPlaybackReceipt(
    () => animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event, clipId }, event === 'STARTED' ? ANIMATION_LIMITS.startMs : 1000),
    () => socket.connected && store.getState().player._authority === 'GRANTED'
      && hasConfirmedPlayback(store.getState().animation.snapshot, grant, socket.id, animationTime()),
  )
  if (result === 'confirmed-state') tracePlayback('playback-receipt-reconciled', { interventionId: grant.interventionId, reason: event })
}

export const fetchAnimationClips = () => new HttpApi('animation/').get<AnimationClip[]>('catalog')
export const fetchPreparedAnimationClips = () => new HttpApi('animation/').get<AnimationClip[]>('preparation')
export const syncAnimation = () => animationRequest(ANIMATION_SYNC)

socket.on('disconnect', () => store.dispatch({ type: ANIMATION_DISCONNECTED }))
socket.on('connect', () => {
  if (canOperate(store.getState().user)) void syncAnimation().catch(() => {})
})
