import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import { catalogClips } from '../Animation/catalog.js'
import { leastUsedAudio } from '../Animation/usage.js'
import { animationPrefs, eligibleAmbience } from '../../shared/animation.js'
import { defaultGreetingPlayback, GREETING_START_MS, type Greeting, type GreetingPlaybackPrefs, type GreetingPreparation, type GreetingAsset, type GreetingTransition } from '../../shared/greetings.js'
import { getGreetingAudioAsset } from './audioRouter.js'
import { prepareCall } from '../Animation/Calls/Playback.js'
import { isGreetingAllowed } from '../../shared/greetings.js'
import { currentSession } from '../Animation/sessions.js'
import { selectAnnouncement } from '../Animation/selection.js'
import { interventionAssets, type Intervention } from '../../shared/animation.js'

export function greetingPlayback (roomId: number) {
  const row = db.get<{ playbackJSON: string, playbackVersion: number, paused: number, audioEnabled: number }>('SELECT * FROM greetingControls WHERE roomId=?', [roomId])
  return { prefs: row ? JSON.parse(row.playbackJSON) as GreetingPlaybackPrefs : { ...defaultGreetingPlayback }, version: row?.playbackVersion ?? 0,
    enabled: !!row?.audioEnabled && !row?.paused && JSON.parse(row.playbackJSON).enabled === true }
}

export async function prepareGreetingTransition (roomId: number, queueId: number): Promise<GreetingPreparation | null> {
  const stored = db.get<Greeting>('SELECT * FROM greetings WHERE roomId=? AND queueId=? AND status=\'QUEUED\'', [roomId, queueId])
  const item = stored && isGreetingAllowed(stored) ? stored : undefined
  const song = Queue.get(roomId).entities[queueId]
  if (!song || song.status !== 'APPROVED') return null
  const call = prepareCall(roomId, queueId)
  if (!item && !call) return null
  const control = greetingPlayback(roomId)
  const assets: GreetingAsset[] = [...(call?.assets ?? [])]
  const room = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])
  const prefs = animationPrefs(room ? JSON.parse(room.data).prefs?.animation : undefined)
  const clips = catalogClips(roomId).filter(clip => clip.approvedForAuto && (!clip.validUntil || clip.validUntil > Date.now()))
  const preferredIntro = control.enabled && item && (!call || call.kind === 'signature')
    ? clips.find(clip => clip.id === control.prefs.introClipId && (clip.kind ?? 'voice') === 'voice')
    : undefined
  if (call?.kind && !preferredIntro && prefs.enabled && prefs.automation && prefs.events.turn && currentSession(roomId)?.status === 'OPEN') {
    const history = db.all<Intervention>('SELECT * FROM animationInterventions WHERE roomId=? ORDER BY requestedAt DESC', [roomId]).map((row) => {
      const intro = (interventionAssets(row) as GreetingAsset[]).find(asset => asset.role === 'intro')
      return intro ? { ...row, displayText: intro.displayText, family: 'turn' } : row
    })
    const intro = selectAnnouncement({ clips, family: 'turn', profile: prefs.profile, history, sessionId: currentSession(roomId)!.sessionId,
      recentSessions: [], ready: clips.map(clip => clip.checksum), now: Date.now(), random: () => 0 }).clip
    if (intro) assets.push({ ...intro, role: 'intro', url: `api/animation/assets/${encodeURIComponent(intro.id)}` })
  }
  if (control.enabled && item) {
    const voice = await getGreetingAudioAsset(roomId, item.greetingId)
    if (voice) {
      assets.push(voice)
      const intro = preferredIntro
      if (intro) assets.push({ ...intro, role: 'intro', url: `api/animation/assets/${encodeURIComponent(intro.id)}` })
      const bed = control.prefs.ambienceEnabled && leastUsedAudio(roomId, eligibleAmbience(clips, prefs))
      if (bed) assets.push({ ...bed, role: 'bed', url: `api/animation/assets/${encodeURIComponent(bed.id)}` })
    }
  }
  return { queueId, greetingId: item?.greetingId ?? null, assets, playbackVersion: control.version, ...(call ? { call } : {}),
    performer: { name: song.userDisplayName, tableLabel: song.tableLabelSnapshot ?? null, requestIntent: song.requestIntent ?? 'UNKNOWN', title: song.title } }
}

/** Reserve startup/fade margin inside the 25 s ceiling; never trim spoken content. */
export function planGreetingTransition (item: Greeting, prepared: GreetingPreparation | null, ready: string[], budgetMs: number, remainingMs = 25000): GreetingTransition | null {
  if (!isGreetingAllowed(item)) return null
  if (!prepared || prepared.greetingId !== item.greetingId || prepared.queueId !== item.queueId) return null
  const available = prepared.assets.filter(asset => ready.includes(asset.checksum))
  const greeting = available.find(asset => asset.role === 'greeting')
  // Only legacy signed speech can stand alone without a prepared attribution.
  if (greeting?.senderIncluded === false) return null
  if (!greeting || greeting.durationMs <= 0 || greeting.durationMs > 20000 || greeting.durationMs > budgetMs) return null
  // Spoken delivery already communicates the full message; do not append the
  // visual-only 10–15 second reading interval after a short greeting.
  const displayMs = Math.max(3000, greeting.durationMs)
  const contentLimit = Math.max(0, Math.min(25000, remainingMs) - GREETING_START_MS)
  if (displayMs + 250 > contentLimit) return null
  let intro = available.find(asset => asset.role === 'intro')
  if (intro && (intro.durationMs + displayMs + 250 > contentLimit || intro.durationMs + greeting.durationMs > budgetMs)) intro = undefined
  const bed = available.find(asset => asset.role === 'bed')
  const assets = [...(intro ? [intro] : []), greeting, ...(bed ? [bed] : [])]
  return { assets, displayMs, voiceMs: (intro?.durationMs ?? 0) + greeting.durationMs, durationMs: (intro?.durationMs ?? 0) + displayMs + 250 }
}
