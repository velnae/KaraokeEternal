export const sceneEvents = ['transition', 'listen', 'karaoke', 'birthday'] as const
export type SceneEvent = typeof sceneEvents[number]
export type SceneLane = 'background' | 'ambience' | 'voice' | 'text'
export type SceneSlot = 'background' | 'ambience' | 'announcement' | 'intro' | 'greeting' | 'signature' | 'music' | 'text'
export interface SceneTextLayout {
  x: number
  y: number
  width: number
  fontSize: number
  weight: 400 | 700
  align: 'left' | 'center' | 'right'
  color: string
  background: string
  backgroundOpacity: number
  shadow: boolean
  family: 'theme' | 'sans' | 'serif'
}
export interface SceneCue {
  id: string
  lane: SceneLane
  slot: SceneSlot
  resourceId: string | null
  anchor: 'start' | 'previous' | 'mediaEnd' | 'block'
  referenceId?: string
  referenceEdge?: 'start' | 'end'
  offsetMs: number
  durationMs: number | null
  volume: number
  fadeMs: number
  animation: 'fade' | 'slide' | 'none'
  position: 'center' | 'bottom'
  text: string
  binding?: 'event' | 'resource'
  enabled?: boolean
  label?: string
  layout?: SceneTextLayout
}
export interface EventScene {
  id: string
  name: string
  event: SceneEvent
  startOffsetMs: number
  continueBed: boolean
  exitMs: number
  cues: SceneCue[]
}
export interface EventSceneSettings {
  revision: number
  templates: EventScene[]
  selected: Partial<Record<SceneEvent, string | null>>
}
export interface SceneResource { id: string, durationMs: number, url?: string, posterUrl?: string, checksum?: string, dimOpacity?: number, parts?: SceneResource[] }
export type SceneResources = Record<string, SceneResource | undefined>
export interface ResolvedSceneCue extends SceneCue { startMs: number, endMs: number, resource?: SceneResource }
export interface SceneTiming { starts?: Record<string, number>, ends?: Record<string, number> }
export const sceneEventLabels: Record<SceneEvent, string> = { transition: 'Transición normal', listen: 'Para escuchar', karaoke: 'Karaoke', birthday: 'Cumpleaños' }
export const sceneSlotLabels: Record<SceneSlot, string> = { background: 'Fondo del evento', ambience: 'Ambiente de la sala', announcement: 'Presentación del pedido', intro: 'Introducción', greeting: 'Saludo', signature: 'Firma del saludo', music: 'Música de cumpleaños', text: 'Datos del evento' }
export const defaultSceneTextLayout = (): SceneTextLayout => ({ x: 10, y: 40, width: 80, fontSize: 72, weight: 700, align: 'center', color: '#ffffff', background: '#000000', backgroundOpacity: 0, shadow: true, family: 'theme' })
export const sceneCueTitle = (cue: SceneCue) => cue.label || (cue.lane === 'text' && cue.text ? cue.text : sceneSlotLabels[cue.slot])
export const sceneCueEnabled = (cue: SceneCue) => cue.enabled !== false
export function sceneResource (cue: SceneCue, resources: SceneResources) {
  return resources[cue.id] ?? (cue.binding !== 'resource' ? resources[cue.slot] : undefined)
}

export function sceneCue (slot: SceneSlot, lane: SceneLane, anchor: SceneCue['anchor'] = 'start'): SceneCue {
  return { id: slot, lane, slot, resourceId: null, anchor, offsetMs: 0, durationMs: null, volume: 1, fadeMs: lane === 'voice' ? 0 : 250, animation: 'fade', position: 'center', text: '' }
}
export function defaultEventScene (event: SceneEvent): EventScene {
  const voice = event === 'birthday'
    ? [sceneCue('intro', 'voice'), sceneCue('greeting', 'voice', 'previous'), sceneCue('music', 'voice', 'previous')]
    : [{ ...sceneCue('announcement', 'voice'), offsetMs: 2000 }, sceneCue('greeting', 'voice', 'previous'), sceneCue('signature', 'voice', 'previous')]
  return { id: event, name: sceneEventLabels[event], event, startOffsetMs: 0, continueBed: false, exitMs: 1000,
    cues: [sceneCue('background', 'background'), sceneCue('ambience', 'ambience'), ...voice, sceneCue('text', 'text')] }
}
export const defaultEventScenes = (): EventSceneSettings => ({ revision: 0, templates: sceneEvents.map(defaultEventScene), selected: {} })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value)
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

export function validateEventScenes (input: unknown): EventSceneSettings {
  if (!record(input) || !Number.isSafeInteger(input.revision) || !number(input.revision, 0, Number.MAX_SAFE_INTEGER - 1)
    || !Array.isArray(input.templates) || input.templates.length > 24 || !record(input.selected)) throw new Error('Revise las plantillas de coreografías.')
  const templates: EventScene[] = input.templates.map((value: unknown) => {
    if (!record(value) || !id(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80
      || !sceneEvents.includes(value.event as SceneEvent) || !number(value.startOffsetMs, -10000, 10000)
      || typeof value.continueBed !== 'boolean' || !number(value.exitMs, 0, 3000) || !Array.isArray(value.cues) || value.cues.length > 24) throw new Error('Revise el nombre y los tiempos de la plantilla.')
    const cues = value.cues.map((item: unknown): SceneCue => {
      if (!record(item) || !id(item.id) || !['background', 'ambience', 'voice', 'text'].includes(String(item.lane))
        || !Object.prototype.hasOwnProperty.call(sceneSlotLabels, String(item.slot)) || !(item.resourceId === null || id(item.resourceId))
        || !['start', 'previous', 'mediaEnd', 'block'].includes(String(item.anchor)) || !number(item.offsetMs, item.anchor === 'block' ? -30000 : 0, 30000)
        || !(item.durationMs === null || number(item.durationMs, 100, 360000)) || !number(item.volume, 0, 1)
        || !number(item.fadeMs, 0, 3000) || !['fade', 'slide', 'none'].includes(String(item.animation))
        || !['center', 'bottom'].includes(String(item.position)) || typeof item.text !== 'string' || item.text.length > 300
        || /[<>]/.test(item.text) || Array.from(item.text).some(char => char.charCodeAt(0) < 32 && char !== '\n')) throw new Error('Revise los bloques y sus tiempos.')
      if ((item.binding !== undefined && !['event', 'resource'].includes(String(item.binding))) || (item.enabled !== undefined && typeof item.enabled !== 'boolean')
        || (item.label !== undefined && (typeof item.label !== 'string' || item.label.length > 80))) throw new Error('Revise el tipo y el nombre del bloque.')
      if (item.binding === 'resource' && !id(item.resourceId)) throw new Error('Seleccione un recurso para el bloque.')
      if (item.anchor === 'block' && (!id(item.referenceId) || !['start', 'end'].includes(String(item.referenceEdge)))) throw new Error('Seleccione el bloque de referencia y su inicio o final.')
      let layout: SceneTextLayout | undefined
      if (item.layout !== undefined) {
        const style = item.layout
        if (!record(style) || item.lane !== 'text' || !number(style.x, 0, 100) || !number(style.y, 0, 95) || !number(style.width, 5, 100)
          || style.x + style.width > 100.01 || !number(style.fontSize, 12, 240) || ![400, 700].includes(Number(style.weight))
          || !['left', 'center', 'right'].includes(String(style.align)) || !/^#[\da-f]{6}$/i.test(String(style.color))
          || !/^#[\da-f]{6}$/i.test(String(style.background)) || !number(style.backgroundOpacity, 0, 100)
          || typeof style.shadow !== 'boolean' || !['theme', 'sans', 'serif'].includes(String(style.family))) throw new Error('Revise la posición y el formato del texto.')
        layout = { x: style.x, y: style.y, width: style.width, fontSize: style.fontSize, weight: style.weight as 400 | 700,
          align: style.align as SceneTextLayout['align'], color: String(style.color), background: String(style.background), backgroundOpacity: style.backgroundOpacity, shadow: style.shadow, family: style.family as SceneTextLayout['family'] }
      }
      if ((item.lane === 'background' && item.slot !== 'background') || (item.lane === 'ambience' && item.slot !== 'ambience')
        || (item.lane === 'text' && item.slot !== 'text') || (item.lane === 'voice' && ['background', 'ambience', 'text'].includes(String(item.slot)))) throw new Error('El recurso no corresponde a esta pista.')
      if (item.lane === 'voice' && item.durationMs !== null) throw new Error('La voz conserva la duración completa del audio.')
      if (item.binding !== 'resource' && item.resourceId && ['greeting', 'signature'].includes(String(item.slot))) throw new Error('Los saludos y firmas usan el audio personalizado del evento.')
      if (item.binding !== 'resource' && item.resourceId && item.slot === 'announcement' && value.event !== 'transition') throw new Error('La presentación usa el audio preparado del pedido.')
      return { id: item.id, lane: item.lane as SceneLane, slot: item.slot as SceneSlot, resourceId: item.resourceId as string | null,
        anchor: item.anchor as SceneCue['anchor'], offsetMs: item.offsetMs, durationMs: item.durationMs as number | null, volume: item.volume,
        fadeMs: item.fadeMs, animation: item.animation as SceneCue['animation'], position: item.position as SceneCue['position'], text: item.text,
        ...(item.binding !== undefined ? { binding: item.binding as SceneCue['binding'] } : {}), ...(item.enabled !== undefined ? { enabled: item.enabled as boolean } : {}),
        ...(item.anchor === 'block' ? { referenceId: String(item.referenceId), referenceEdge: item.referenceEdge as 'start' | 'end' } : {}),
        ...(item.label !== undefined ? { label: String(item.label) } : {}), ...(layout ? { layout } : {}) }
    })
    const eventCues = cues.filter(cue => cue.lane !== 'text' && cue.binding !== 'resource')
    if (new Set(cues.map(cue => cue.id)).size !== cues.length || new Set(eventCues.map(cue => cue.slot)).size !== eventCues.length) throw new Error('Use un solo bloque por dato del evento.')
    if (cues.filter(cue => cue.lane === 'ambience' && sceneCueEnabled(cue)).length > 1) throw new Error('Use un ambiente activo por escena. Puede reemplazar su recurso.')
    if (value.event === 'birthday' && ['intro', 'greeting', 'music'].some(slot => !cues.some(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === slot && sceneCueEnabled(cue)))) throw new Error('El cumpleaños necesita introducción, saludo y música.')
    if (value.event !== 'birthday' && ['greeting', 'signature', ...(['listen', 'karaoke'].includes(String(value.event)) ? ['announcement'] : [])].some(slot => !cues.some(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === slot && sceneCueEnabled(cue)))) throw new Error('Conserve los audios vinculados al pedido para mantener su identidad y atribución.')
    validateSceneReferences(cues)
    return { id: value.id, name: value.name.trim(), event: value.event as SceneEvent, startOffsetMs: value.startOffsetMs,
      continueBed: value.continueBed, exitMs: value.exitMs, cues }
  })
  if (new Set(templates.map(template => template.id)).size !== templates.length) throw new Error('Las plantillas deben tener identificadores diferentes.')
  const selected: EventSceneSettings['selected'] = {}
  for (const [event, templateId] of Object.entries(input.selected)) {
    if (!sceneEvents.includes(event as SceneEvent) || !(templateId === null || templates.some(template => template.id === templateId && template.event === event))) throw new Error('Seleccione una plantilla del tipo de evento correcto.')
    selected[event as SceneEvent] = templateId as string | null
  }
  return { revision: input.revision, templates, selected }
}
export function selectedEventScene (settings: EventSceneSettings | undefined, event: SceneEvent): EventScene | null {
  return settings?.templates.find(scene => scene.id === settings.selected[event] && scene.event === event) ?? null
}
export function sceneEventFor (item?: { requestIntent?: string, origin?: string }): SceneEvent {
  return item?.requestIntent === 'SING' ? 'karaoke' : item?.requestIntent === 'LISTEN' && item.origin === 'PARTICIPANT' ? 'listen' : 'transition'
}

export const sceneHasReferences = (scene: EventScene) => scene.cues.some(cue => cue.anchor === 'block')

export function scenePreviousCue (scene: EventScene, cue: SceneCue, resources?: SceneResources) {
  return scene.cues.slice(0, scene.cues.findIndex(item => item.id === cue.id)).reverse().find(item => item.lane === 'voice' && sceneCueEnabled(item) && (!resources || !!sceneResource(item, resources)))
}

/** Validate identities/dependencies independently of media preparation or array order. */
export function validateSceneReferences (cues: SceneCue[]) {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const complete = new Set<string>()
  const path: string[] = []
  const visit = (cue: SceneCue) => {
    if (complete.has(cue.id)) return
    if (path.includes(cue.id)) throw new Error(`Referencia circular: ${[...path.slice(path.indexOf(cue.id)), cue.id].map(id => sceneCueTitle(byId.get(id)!)).join(' → ')}.`)
    path.push(cue.id)
    if (cue.anchor === 'block') {
      const target = byId.get(cue.referenceId ?? '')
      if (!target) throw new Error(`El bloque «${sceneCueTitle(cue)}» referencia un bloque que ya no existe.`)
      if (cue.referenceEdge === 'end' && target.lane !== 'voice' && target.durationMs === null) throw new Error(`Defina la duración de «${sceneCueTitle(target)}» antes de usar su final como referencia.`)
      visit(target)
    } else if (cue.anchor === 'previous') {
      const index = cues.indexOf(cue)
      const previous = cues.slice(0, index).reverse().find(item => item.lane === 'voice' && sceneCueEnabled(item))
      if (previous) visit(previous)
    }
    path.pop()
    complete.add(cue.id)
  }
  cues.forEach(visit)
}

/** Resolve a dependency graph from prepared media, never from estimated TTS lengths. */
export function resolveEventScene (scene: EventScene, resources: SceneResources, mediaEndMs = Math.max(0, -scene.startOffsetMs), timing?: SceneTiming, checkOverlap = true): ResolvedSceneCue[] {
  validateSceneReferences(scene.cues)
  const byId = new Map(scene.cues.map(cue => [cue.id, cue]))
  const resolved = new Map<string, ResolvedSceneCue | null>()
  const visiting = new Set<string>()
  const resolve = (cue: SceneCue): ResolvedSceneCue | null => {
    if (resolved.has(cue.id)) return resolved.get(cue.id)!
    if (visiting.has(cue.id)) throw new Error(`Referencia circular en «${sceneCueTitle(cue)}».`)
    visiting.add(cue.id)
    const resource = sceneResource(cue, resources)
    let result: ResolvedSceneCue | null = null
    if (sceneCueEnabled(cue) && (cue.lane !== 'voice' || resource)) {
      let base = 0
      let available = true
      if (cue.anchor === 'block') {
        const target = resolve(byId.get(cue.referenceId!)!)
        available = !!target
        if (target) base = cue.referenceEdge === 'start' ? target.startMs : target.endMs
      } else if (cue.anchor === 'previous') {
        const previous = scenePreviousCue(scene, cue, resources)
        const target = previous ? resolve(previous) : null
        available = !previous || !!target
        base = target?.endMs ?? 0
      } else if (cue.anchor === 'mediaEnd') base = mediaEndMs
      if (available) {
        const startMs = timing?.starts?.[cue.id] ?? (cue.anchor === 'block' ? base + cue.offsetMs : Math.max(0, base + cue.offsetMs))
        if (startMs < 0) throw new Error(`«${sceneCueTitle(cue)}» queda antes del inicio de la plantilla. Ajuste su referencia o el desfase.`)
        const duration = cue.lane === 'voice' ? resource!.durationMs : cue.durationMs ?? resource?.durationMs ?? 10000
        result = { ...cue, startMs, endMs: timing?.ends?.[cue.id] ?? startMs + duration, resource }
      }
    }
    visiting.delete(cue.id)
    resolved.set(cue.id, result)
    return result
  }
  const result = scene.cues.map(resolve).filter((cue): cue is ResolvedSceneCue => !!cue)
  if (checkOverlap) {
    const voices = result.filter(cue => cue.lane === 'voice').sort((a, b) => a.startMs - b.startMs)
    for (let index = 1; index < voices.length; index++) if (voices[index].startMs < voices[index - 1].endMs) {
      throw new Error(`Los audios de voz y efectos no pueden superponerse: «${sceneCueTitle(voices[index - 1])}» y «${sceneCueTitle(voices[index])}».`)
    }
    const order: SceneSlot[] = scene.event === 'birthday' ? ['intro', 'greeting', 'music'] : ['announcement', 'greeting', 'signature']
    const native = voices.filter(cue => cue.binding !== 'resource' && order.includes(cue.slot))
    for (let index = 1; index < native.length; index++) if (order.indexOf(native[index].slot) < order.indexOf(native[index - 1].slot)) throw new Error('Los audios vinculados no pueden superponerse ni cambiar su orden de atribución.')
  }
  return result
}
export function sceneVoiceCue (scene: EventScene | null | undefined, role: string, cueId?: string) {
  if (cueId) return scene?.cues.find(cue => cue.id === cueId && sceneCueEnabled(cue))
  const slot = role === 'call' ? 'announcement' : role
  return scene?.cues.find(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === slot && sceneCueEnabled(cue))
    ?? (role === 'intro' || role === 'effect' ? scene?.cues.find(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === 'announcement' && sceneCueEnabled(cue)) : undefined)
}

export function resolveSceneVisuals (scene: EventScene, resources: SceneResources, mediaEndMs = 0, timing?: SceneTiming) {
  let resolved: ResolvedSceneCue[]
  try {
    resolved = resolveEventScene(scene, resources, mediaEndMs, timing, !timing)
  } catch {
    // An unavailable audio arrangement must not take down the public player.
    try {
      resolved = resolveEventScene(scene, {}, mediaEndMs, undefined, false)
    } catch { resolved = [] }
  }
  return resolved.filter(cue => cue.lane === 'text' || cue.lane === 'background').map(cue => ({ ...cue, endMs: cue.durationMs === null ? Infinity : cue.endMs }))
}

export function resolveSceneTimeline (scene: EventScene, resources: SceneResources, mediaEndMs = Math.max(0, -scene.startOffsetMs)) {
  const cues = resolveEventScene(scene, resources, mediaEndMs)
  const finite = cues.filter(cue => cue.lane === 'voice' || cue.durationMs !== null)
  const durationMs = Math.max(finite.length ? 1000 : 10000, ...finite.map(cue => cue.endMs))
  return { durationMs, cues: cues.map(cue => cue.lane !== 'voice' && cue.durationMs === null ? { ...cue, endMs: Math.max(cue.startMs + 1000, durationMs) } : cue) }
}

export function sceneTextValue (text: string, values: Record<string, string>) {
  return text.replace(/\{(name|table|song|venue|message|sender)\}/g, (_match, key: string) => values[key] ?? '')
}

export function splitSceneData (scene: EventScene, cueId: string): EventScene {
  const original = scene.cues.find(cue => cue.id === cueId)
  if (!original) return scene
  const fields = scene.event === 'birthday'
    ? [['birthday-title', '¡Feliz cumpleaños!', 28, 64], ['name', '{name}', 45, 112]] as const
    : [['venue', '{venue}', 12, 40], ['name', '{name}', 32, 96], ['table', '{table}', 49, 48], ['song', '{song}', 62, 60]] as const
  const cues = fields.map(([id, text, y, fontSize], index) => ({ ...original, id: index === 0 ? cueId : `${cueId}-${id}`, text, label: id === 'birthday-title' ? 'Título' : id === 'name' ? 'Nombre' : id === 'table' ? 'Mesa' : id === 'song' ? 'Canción' : 'Local', layout: { ...defaultSceneTextLayout(), y, fontSize } }))
  return { ...scene, cues: scene.cues.flatMap(cue => cue.id === cueId ? cues : [cue]) }
}

export interface SceneProgress { position: number, duration: number, playing: boolean }
export function sceneTailDue (scene: EventScene | null, progress: SceneProgress): boolean {
  return !!scene && scene.startOffsetMs < 0 && progress.playing && Number.isFinite(progress.position) && Number.isFinite(progress.duration)
    && progress.duration > 0 && progress.position >= 0 && progress.position < progress.duration
    && (progress.duration - progress.position) * 1000 <= -scene.startOffsetMs
}

export function sceneContextAfterEnd (reserved: string, current: string, endedIds: number[]): boolean {
  if (reserved === current) return true
  try {
    const before = JSON.parse(reserved) as [unknown[][], unknown]
    const after = JSON.parse(current)
    if (!Array.isArray(before[0])) return false
    return JSON.stringify([before[0].filter(item => !(item[2] === 'PLAYING' && endedIds.includes(item[0] as number))), before[1]]) === JSON.stringify(after)
  } catch { return false }
}
