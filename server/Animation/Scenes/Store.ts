import { db } from '../../lib/Database.js'
import { defaultEventScenes, validateEventScenes, selectedEventScene, sceneEventFor, sceneCueEnabled, resolveEventScene, type EventScene, type SceneResources, type EventSceneSettings } from '../../../shared/eventScenes.js'
import Queue from '../../Queue/Queue.js'
import { leasedEventScene, captureTransitionBackground } from '../../TransitionVideo/Playback.js'
import type { AnimationClip } from '../../../shared/animation.js'
import type { TransitionVideoBackground } from '../../../shared/transitionVideo.js'
import { catalogClips } from '../catalog.js'
import { getTransitionVideo } from '../../TransitionVideo/Store.js'
import { asset } from '../../Birthdays/Store.js'

export function getEventScenes (roomId: number): EventSceneSettings {
  const row = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])
  if (!row) throw Object.assign(new Error('No se encontró la sala.'), { status: 404 })
  const value = JSON.parse(row.data).prefs?.eventScenes
  return value ? validateEventScenes(value) : defaultEventScenes()
}

export function sceneFixedAudio (roomId: number, scene: EventScene | null, ready?: string[]): Record<string, AnimationClip> {
  const clips = catalogClips(roomId)
  const result: Record<string, AnimationClip> = {}
  for (const cue of scene?.cues ?? []) {
    if (!sceneCueEnabled(cue) || cue.lane !== 'voice' || cue.binding !== 'resource') continue
    let clip = clips.find(clip => clip.id === cue.resourceId && clip.kind !== 'ambience' && (!clip.validUntil || clip.validUntil > Date.now()))
    const birthday = scene?.event === 'birthday' && cue.resourceId ? asset(roomId, cue.resourceId) : null
    if (!clip && birthday && ['intro', 'music'].includes(birthday.kind)) clip = { id: birthday.id, kind: 'voice', title: birthday.title, durationMs: birthday.durationMs, checksum: birthday.checksum, displayText: '', source: 'birthday', license: 'Room birthday resource' }
    if (!clip || (ready && !ready.includes(clip.checksum))) throw new Error(`Prepare el audio «${cue.label ?? cue.slot}» antes de iniciar la escena.`)
    result[cue.id] = { ...clip, sceneCueId: cue.id }
  }
  return result
}

export function sceneAudioUrl (clip: AnimationClip) {
  return clip.source === 'birthday' ? `api/birthdays/assets/${encodeURIComponent(clip.id)}` : `api/animation/assets/${encodeURIComponent(clip.id)}`
}

export function sceneVisualResources (roomId: number, scene: EventScene | null, native?: TransitionVideoBackground | null, lease?: { key: string, until: number }): SceneResources {
  const resources: SceneResources = {}
  for (const cue of scene?.cues ?? []) {
    if (!sceneCueEnabled(cue) || cue.lane !== 'background') continue
    if (!cue.resourceId && cue.binding !== 'resource' && native) {
      const video = native.resource
      resources[cue.id] = { id: video.id, durationMs: video.durationMs ?? 10000, url: video.videoUrl ?? undefined, posterUrl: video.posterUrl ?? undefined, dimOpacity: native.dimOpacity }
    } else if (cue.resourceId) {
      const video = getTransitionVideo(roomId, cue.resourceId)
      if (!video || video.state !== 'ready' || !video.active) continue
      if (lease) captureTransitionBackground(roomId, `${lease.key}:${cue.id}`, lease.until, false, video.id)
      resources[cue.id] = { id: video.id, durationMs: video.durationMs!, url: `api/animation/background/videos/${video.id}/video`, posterUrl: `api/animation/background/videos/${video.id}/poster`, dimOpacity: scene?.event === 'birthday' ? 0 : 0.55 }
    }
  }
  return resources
}
export function saveEventScenes (roomId: number, input: unknown) {
  const settings = validateEventScenes(input)
  const clips = catalogClips(roomId)
  for (const template of settings.templates) {
    const resources: SceneResources = {}
    for (const cue of template.cues) {
      if (!cue.resourceId) continue
      const video = cue.lane === 'background' ? getTransitionVideo(roomId, cue.resourceId) : null
      const birthday = template.event === 'birthday' ? asset(roomId, cue.resourceId) : null
      const clip = clips.find(clip => clip.id === cue.resourceId)
      if (cue.lane === 'voice' && (birthday || clip)) resources[cue.id] = { id: cue.resourceId, durationMs: (birthday ?? clip)!.durationMs }
      if (cue.lane === 'background'
        ? !(video?.state === 'ready' && video.active) && birthday?.kind !== 'video'
        : cue.lane === 'ambience'
          ? clip?.kind !== 'ambience'
          : cue.lane === 'voice' ? !(clip && clip.kind !== 'ambience') && !(birthday && (birthday.kind === cue.slot || (cue.binding === 'resource' && ['intro', 'music'].includes(birthday.kind)))) : true) throw new Error('Seleccione un recurso disponible para esta pista y sala.')
    }
    resolveEventScene(template, resources)
  }
  const next = { ...settings, revision: settings.revision + 1 }
  const saved = db.run(`UPDATE rooms SET data=json_set(data,'$.prefs.eventScenes',json(?))
    WHERE roomId=? AND COALESCE(json_extract(data,'$.prefs.eventScenes.revision'),0)=?`, [JSON.stringify(next), roomId, settings.revision])
  if (!saved.changes) throw Object.assign(new Error('Las coreografías cambiaron. Recargue antes de guardar.'), { status: 409 })
  return next
}

export function eventSceneForQueue (roomId: number, queueId: number | null, ownerSocketId?: string) {
  if (ownerSocketId) {
    const held = leasedEventScene(roomId, queueId, ownerSocketId)
    if (held !== undefined) return held
  }
  return selectedEventScene(getEventScenes(roomId), sceneEventFor(queueId === null ? undefined : Queue.get(roomId).entities[queueId]))
}
export function sceneTailAllowed (roomId: number, queueId: number | null, status: { queueId?: number, position?: number, duration?: number, isPlaying?: boolean }, ownerSocketId?: string) {
  const scene = eventSceneForQueue(roomId, queueId, ownerSocketId)
  const source = status.queueId === undefined ? undefined : Queue.get(roomId).entities[status.queueId]
  return !!scene && scene.startOffsetMs < 0 && source?.status === 'PLAYING' && status.isPlaying === true
    && Number.isFinite(status.duration) && Number.isFinite(status.position) && status.duration! > 0 && status.position! >= 0
    && status.duration! - status.position! >= 0 && (status.duration! - status.position!) * 1000 <= -scene.startOffsetMs + 750
}

/** A real end may arrive while a tail-start receipt is in flight. */
export function sceneBoundaryContextMatches (roomId: number, reserved: string, current: string) {
  if (reserved === current) return true
  try {
    const before = JSON.parse(reserved)
    const after = JSON.parse(current)
    if (!Array.isArray(before[0]) || !Array.isArray(after[0])) return false
    const ended = before[0].filter((item: unknown[]) => item[2] === 'PLAYING'
      && db.get<{ status: string }>('SELECT status FROM queue WHERE roomId=? AND queueId=?', [roomId, item[0]])?.status === 'PLAYED')
    if (!ended.length) return false
    return JSON.stringify([before[0].filter((item: unknown[]) => !ended.includes(item)), before[1]]) === JSON.stringify(after)
  } catch { return false }
}
