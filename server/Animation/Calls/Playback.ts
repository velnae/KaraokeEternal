import { db } from '../../lib/Database.js'
import { animationPrefs } from '../../../shared/animation.js'
import { GREETING_START_MS, greetingDuration, type Greeting, type GreetingPreparation, type GreetingTransition } from '../../../shared/greetings.js'
import type { CallContext } from '../../../shared/karaokeCalls.js'
import { callControls, callSessionAllows } from './Store.js'
import { getCallAutomation } from './Automation.js'

export function callsEnabled (roomId: number) {
  const room = db.get<{ data: string, status: string }>('SELECT data,status FROM rooms WHERE roomId=?', [roomId])
  const prefs = animationPrefs(room ? JSON.parse(room.data).prefs?.animation : undefined)
  return room?.status === 'open' && callControls(roomId).enabled && prefs.enabled && prefs.automation && prefs.events.turn && callSessionAllows(roomId)
}
export const prepareCall = (roomId: number, queueId: number) => callsEnabled(roomId) ? getCallAutomation()?.preparation(roomId, queueId) ?? null : null
export const validCall = (roomId: number, context: CallContext, started = false) => callsEnabled(roomId) && getCallAutomation()?.valid(roomId, context, started) === true

/** One finite reservation contains the call and, when it fits, the greeting. */
export function planCallTransition (roomId: number, greeting: Greeting | null, prepared: GreetingPreparation, ready: string[], budgetMs: number, remainingMs: number): GreetingTransition | null {
  const call = prepared.call
  if (!call) return null
  const limit = Math.max(0, Math.min(25000, remainingMs) - GREETING_START_MS - 250)
  const selected = call.assets.find(asset => ready.includes(asset.checksum) && asset.durationMs <= Math.min(limit, budgetMs))
  if (!selected) return null
  const context: CallContext = { queueId: call.queueId, inputKey: call.inputKey, revision: call.revision, partId: selected.partId }
  if (!validCall(roomId, context)) return null
  const available = prepared.assets.filter(asset => ready.includes(asset.checksum))
  const voice = greeting && available.find(asset => asset.role === 'greeting')
  const spoken = voice && selected.durationMs + Math.max(3000, voice.durationMs) <= limit && selected.durationMs + voice.durationMs <= budgetMs ? voice : null
  const displayMs = greeting ? spoken ? Math.max(3000, spoken.durationMs) : greetingDuration(greeting) : 0
  // Visual reading overlaps the call instead of adding another full interval.
  const durationMs = spoken ? selected.durationMs + displayMs : Math.max(selected.durationMs, displayMs)
  if (durationMs > limit) return null
  const bed = available.find(asset => asset.role === 'bed')
  return { assets: [selected, ...(spoken ? [spoken] : []), ...(bed ? [bed] : [])], call: context,
    displayMs, durationMs: durationMs + 250, voiceMs: selected.durationMs + (spoken?.durationMs ?? 0) }
}
