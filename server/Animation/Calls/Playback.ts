import { db } from '../../lib/Database.js'
import { animationPrefs } from '../../../shared/animation.js'
import { GREETING_START_MS, greetingDuration, type Greeting, type GreetingPreparation, type GreetingTransition } from '../../../shared/greetings.js'
import type { CallContext } from '../../../shared/karaokeCalls.js'
import { callControls, callSessionAllows, part } from './Store.js'
import { getCallAutomation } from './Automation.js'
import Queue from '../../Queue/Queue.js'
import getLogger from '../../lib/Log.js'

export function callsEnabled (roomId: number) {
  const room = db.get<{ data: string, status: string }>('SELECT data,status FROM rooms WHERE roomId=?', [roomId])
  const prefs = animationPrefs(room ? JSON.parse(room.data).prefs?.animation : undefined)
  return room?.status === 'open' && callControls(roomId).enabled && prefs.enabled && prefs.automation && prefs.events.turn && callSessionAllows(roomId)
}
export function listeningEnabled (roomId: number) {
  const room = db.get<{ data: string, status: string }>('SELECT data,status FROM rooms WHERE roomId=?', [roomId])
  const prefs = animationPrefs(room ? JSON.parse(room.data).prefs?.animation : undefined)
  return room?.status === 'open' && !!callControls(roomId).listeningEnabled && prefs.enabled && prefs.automation && prefs.events.turn && callSessionAllows(roomId)
}

/** Called once when authoritative playback consumes the announcement opportunity. */
export function recordCallOmission (roomId: number, queueId: number) {
  const item = db.get<{ requestIntent: string }>(`SELECT requestIntent FROM queue WHERE roomId=? AND queueId=? AND status='PLAYING' AND origin='PARTICIPANT'`, [roomId, queueId])
  const listening = item?.requestIntent === 'LISTEN'
  if (!item || (listening ? !listeningEnabled(roomId) : item.requestIntent !== 'SING' || !callsEnabled(roomId))) return
  const table = listening ? 'listeningPresentations' : 'karaokeCallRequests'
  const row = db.get<{ resultId: string | null, playbackReason: string | null }>(`SELECT resultId,playbackReason FROM ${table} WHERE roomId=? AND queueId=?`, [roomId, queueId])
  if (!row || row.playbackReason || db.get(`SELECT 1 FROM animationInterventions WHERE roomId=?
    AND json_extract(callJSON,'$.queueId')=? AND (json_extract(callJSON,'$.kind')='listening' OR json_extract(callJSON,'$.kind') IS NULL) LIMIT 1`, [roomId, queueId])) return
  const reason = row.resultId && part(roomId, row.resultId) ? 'not-reserved' : 'preparation-unavailable'
  db.run(`UPDATE ${table} SET playbackReason=? WHERE roomId=? AND queueId=? AND playbackReason IS NULL`, [reason, roomId, queueId])
  getLogger('calls').info('Call omitted room=%s queue=%s reason=%s result=%s stage=music-start', roomId, queueId, reason, row.resultId)
}
const signatureEnabled = (roomId: number) => !!db.get(`SELECT 1 FROM greetingControls WHERE roomId=? AND audioEnabled=1 AND paused=0 AND json_extract(playbackJSON,'$.enabled')=1`, [roomId])
export const prepareCall = (roomId: number, queueId: number) => {
  const prepared = getCallAutomation()?.preparation(roomId, queueId)
  if (!prepared) return null
  const canPresent = prepared.kind === 'listening' ? listeningEnabled(roomId) : !prepared.kind && callsEnabled(roomId)
  const assets = prepared.assets.filter(asset => asset.role === 'signature' ? signatureEnabled(roomId) : canPresent)
  if (!canPresent && assets.length) return { ...prepared, kind: 'signature' as const, inputKey: prepared.signatureKey ?? prepared.inputKey, assets }
  return canPresent ? prepared : null
}
export const validCall = (roomId: number, context: CallContext, started = false) => {
  let allowed = callsEnabled(roomId)
  if (context.kind === 'signature') allowed = signatureEnabled(roomId)
  if (context.kind === 'listening') {
    const room = db.get<{ data: string, status: string }>('SELECT data,status FROM rooms WHERE roomId=?', [roomId])
    allowed = listeningEnabled(roomId) || (started && room?.status === 'open' && animationPrefs(JSON.parse(room.data).prefs?.animation).enabled)
  }
  return allowed && Queue.get(roomId).entities[context.queueId]?.status === 'APPROVED' && getCallAutomation()?.valid(roomId, context, started) === true
}

/** One finite reservation contains the call and, when it fits, the greeting. */
export function planCallTransition (roomId: number, greeting: Greeting | null, prepared: GreetingPreparation, ready: string[], budgetMs: number, remainingMs: number): GreetingTransition | null {
  const call = prepared.call
  if (!call) return null
  if (call.kind) return planListeningTransition(roomId, greeting, prepared, ready, budgetMs, remainingMs)
  const limit = Math.max(0, Math.min(25000, remainingMs) - GREETING_START_MS - 250)
  const selected = call.assets.find(asset => asset.role === 'call' && ready.includes(asset.checksum) && asset.durationMs <= Math.min(limit, budgetMs))
  if (!selected) return null
  const context: CallContext = { queueId: call.queueId, inputKey: call.inputKey, revision: call.revision, partId: selected.partId }
  if (!validCall(roomId, context)) return null
  const available = prepared.assets.filter(asset => ready.includes(asset.checksum))
  const voice = greeting && available.find(asset => asset.role === 'greeting')
  const signature = !selected.identifiesSender && available.find(asset => asset.role === 'signature')
  const signatureMs = signature?.durationMs ?? 0
  const attributed = selected.identifiesSender !== false || !!signature
  const spoken = voice && attributed && selected.durationMs + Math.max(3000, voice.durationMs + signatureMs) <= limit && selected.durationMs + voice.durationMs + signatureMs <= budgetMs ? voice : null
  const displayMs = greeting ? spoken ? Math.max(3000, spoken.durationMs + signatureMs) : greetingDuration(greeting) : 0
  // Visual reading overlaps the call instead of adding another full interval.
  const durationMs = spoken ? selected.durationMs + displayMs : Math.max(selected.durationMs, displayMs)
  if (durationMs > limit) return null
  const bed = available.find(asset => asset.role === 'bed')
  return { assets: [selected, ...(spoken ? [spoken, ...(signature ? [signature] : [])] : []), ...(bed ? [bed] : [])], call: context,
    displayMs, durationMs: durationMs + 250, voiceMs: selected.durationMs + (spoken ? spoken.durationMs + signatureMs : 0) }
}

function planListeningTransition (roomId: number, greeting: Greeting | null, prepared: GreetingPreparation, ready: string[], budgetMs: number, remainingMs: number): GreetingTransition | null {
  const call = prepared.call!
  const available = prepared.assets.filter(asset => ready.includes(asset.checksum))
  const limit = Math.max(0, Math.min(25000, remainingMs) - GREETING_START_MS - 250)
  const signature = available.find(asset => asset.role === 'signature')
  let presentation = call.kind === 'listening' ? available.find(asset => asset.role === 'call') : undefined
  let spoken = greeting ? available.find(asset => asset.role === 'greeting') : undefined
  const fits = (voice: number, visual = voice) => voice <= budgetMs && Math.max(voice, visual) <= limit
  // Reserve an attributed message first. Presentation replaces its signature.
  if (spoken && !fits(spoken.durationMs + (signature?.durationMs ?? presentation?.durationMs ?? Infinity), 3000)) spoken = undefined
  if (presentation && !fits(presentation.durationMs + (spoken?.durationMs ?? 0), greeting && !spoken ? greetingDuration(greeting) : 3000)) presentation = undefined
  const attribution = !presentation && spoken ? signature : undefined
  if (spoken && !presentation && !attribution) spoken = undefined
  const voiceMs = (presentation?.durationMs ?? 0) + (spoken?.durationMs ?? 0) + (attribution?.durationMs ?? 0)
  const displayMs = greeting ? spoken ? Math.max(3000, spoken.durationMs + (attribution?.durationMs ?? 0)) : greetingDuration(greeting) : 0
  let durationMs = spoken ? (presentation?.durationMs ?? 0) + displayMs : Math.max(presentation?.durationMs ?? 0, displayMs)
  const selected = presentation ?? attribution
  if (!selected?.partId || !fits(voiceMs, durationMs)) return null
  const context: CallContext = { kind: presentation ? 'listening' : 'signature', queueId: call.queueId,
    inputKey: presentation ? call.inputKey : call.signatureKey ?? call.inputKey, revision: call.revision, partId: selected.partId }
  if (!validCall(roomId, context)) return null
  const intro = available.find(asset => asset.role === 'intro' && fits(voiceMs + asset.durationMs, durationMs + asset.durationMs))
  durationMs += intro?.durationMs ?? 0
  const bed = available.find(asset => asset.role === 'bed')
  return { assets: [...(intro ? [intro] : []), ...(presentation ? [presentation] : []), ...(spoken ? [spoken] : []), ...(attribution ? [attribution] : []), ...(bed ? [bed] : [])],
    call: context, displayMs, durationMs: durationMs + 250, voiceMs: voiceMs + (intro?.durationMs ?? 0) }
}

/** Explain a rejected plan using the same planner, rather than a second set of limits. */
export function callTransitionFailure (roomId: number, greeting: Greeting | null, prepared: GreetingPreparation | null, ready: string[], budgetMs: number, remainingMs: number) {
  if (!prepared?.call) return 'preparation-unavailable'
  const call = prepared.call
  if (!call.assets.some(asset => (call.kind !== 'listening' || asset.role === 'call') && ready.includes(asset.checksum))) return 'audio-not-ready'
  const canPresent = (budget: number, remaining: number) => {
    const plan = planCallTransition(roomId, greeting, prepared, ready, budget, remaining)
    return call.kind === 'listening' ? plan?.call?.kind === 'listening' : !!plan
  }
  if (canPresent(Infinity, remainingMs)) return 'voice-budget'
  if (canPresent(Infinity, 25000)) return 'transition-time'
  if (!call.assets.some(asset => validCall(roomId, { kind: call.kind, queueId: call.queueId, inputKey: call.inputKey, revision: call.revision, partId: asset.partId }))) return 'request-changed'
  return 'audio-not-ready'
}
