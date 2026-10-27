import socket from './socket'
import store from 'store/store'
import { ANIMATION_SYNC, ANIMATION_STATE, ANIMATION_DISCONNECTED, type AnimationReply, type AnimationClip } from 'shared/animation'
import HttpApi from './HttpApi'

export function animationTime () {
  const { snapshot, receivedAt } = store.getState().animation
  return snapshot ? snapshot.serverTime + Date.now() - receivedAt : Date.now()
}

export function animationRequest (type: string, payload: object = {}, timeout = 2000): Promise<AnimationReply> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Sin conexión. La orden no se envió.'))
    const socketId = socket.id
    socket.timeout(timeout).emit('action', { type, payload: { ...payload, expiresAt: animationTime() + timeout } }, (error: Error | null, reply: AnimationReply) => {
      if (error || socket.id !== socketId) return reject(new Error('Sin confirmación. Consulte el estado antes de repetir.'))
      if (reply?.payload) store.dispatch({ type: ANIMATION_STATE, payload: reply.payload })
      if (reply?.error) return reject(new Error(reply.error))
      resolve(reply)
    })
  })
}

export const fetchAnimationClips = () => new HttpApi('animation/').get<AnimationClip[]>('catalog')
export const fetchPreparedAnimationClips = () => new HttpApi('animation/').get<AnimationClip[]>('preparation')
export const syncAnimation = () => animationRequest(ANIMATION_SYNC)

socket.on('disconnect', () => store.dispatch({ type: ANIMATION_DISCONNECTED }))
socket.on('connect', () => {
  if (store.getState().user.isAdmin) void syncAnimation().catch(() => {})
})
