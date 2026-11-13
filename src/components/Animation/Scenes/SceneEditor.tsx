import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import HttpApi from 'lib/HttpApi'
import { useAppSelector } from 'store/hooks'
import { defaultEventScene, defaultSceneTextLayout, resolveSceneTimeline, sceneCue, sceneCueEnabled, sceneCueTitle, sceneEventLabels, sceneEvents, splitSceneData, validateEventScenes, type EventScene, type EventSceneSettings, type SceneCue, type SceneEvent, type SceneResources } from 'shared/eventScenes'
import type { AnimationClip } from 'shared/animation'
import type { TransitionVideo } from 'shared/transitionVideo'
import ScenePreview, { type ScenePreviewHandle } from './ScenePreview'
import SceneInspector from './SceneInspector'
import SceneResourcePicker from './SceneResourcePicker'
import SceneNumber from './SceneNumber'
import useSceneHistory from './useSceneHistory'
import { timelineRows } from './timelineRows'
import SceneTiming from './SceneTiming'
import SceneLinks from './SceneLinks'
import { sceneLinks } from './sceneLinks'
import SceneIconButton from './SceneIconButton'
import styles from './Scenes.css'

interface Overview { settings: EventSceneSettings, audio: AnimationClip[], videos: TransitionVideo[], defaultResources?: SceneResources }
interface Example { id: string, label: string, event: SceneEvent }
interface ExampleData { values: Record<string, string>, resources: SceneResources }
const api = new HttpApi('animation/scenes/')
const lanes = { background: 'Fondo', ambience: 'Ambiente', voice: 'Voz y efectos', text: 'Textos' } as const
const defaults = () => ({ name: 'Alex', table: 'Mesa 3', song: 'Mi canción', venue: 'Il Gatto', message: '', sender: '' })

export default function SceneEditor () {
  const draftKey = useAppSelector(state => `${state.user.userId}:${state.user.roomId}`)
  const history = useSceneHistory(draftKey)
  const loadHistory = history.load
  const resetHistory = history.reset
  const settings = history.settings
  const [saved, setSaved] = useState<EventSceneSettings | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const { event, templateId } = history
  const [cueId, setCueId] = useState<string | null>('announcement')
  const [samples, setSamples] = useState<Record<string, string>>({})
  const [exampleResources, setExampleResources] = useState<SceneResources>({})
  const [values, setValues] = useState<Record<string, string>>(defaults)
  const [examples, setExamples] = useState<Example[]>([])
  const [exampleId, setExampleId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<{ video: boolean, replace?: string } | null>(null)
  const [time, setTime] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(true)
  const preview = useRef<ScenePreviewHandle>(null)
  const exampleVersion = useRef(0)
  const timelineContent = useRef<HTMLDivElement>(null)
  const templateActions = useRef<HTMLDetailsElement>(null)
  const scene = settings?.templates.find(scene => scene.id === templateId && scene.event === event)
  const audioChoices = useMemo(() => overview?.audio.filter(clip => clip.source !== 'birthday' || event === 'birthday') ?? [], [overview, event])
  const cue = scene?.cues.find(cue => cue.id === cueId)
  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved])
  const load = useCallback((discard = false) => {
    setError('')
    void api.get<Overview>('').then((data): void => {
      setOverview(data)
      setSaved(data.settings)
      if (discard) resetHistory(data.settings)
      else loadHistory(data.settings)
      return undefined
    }).catch(error => setError(error.message))
    void api.get<Example[]>('examples').then(setExamples).catch(() => {})
  }, [loadHistory, resetHistory])
  useEffect(() => load(), [load])
  useEffect(() => {
    if (!dirty) return
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [dirty])
  const update = (patch: Partial<EventScene>) => {
    setNotice('')
    history.edit(settings => ({ ...settings, templates: settings.templates.map(scene => scene.id === templateId ? { ...scene, ...patch } : scene) }))
  }
  const changeCue = (id: string, patch: Partial<SceneCue>, record = true) => {
    setNotice('')
    history.edit(settings => ({ ...settings, templates: settings.templates.map(scene => scene.id === templateId ? { ...scene, cues: scene.cues.map(cue => cue.id === id ? { ...cue, ...patch } : cue) } : scene) }), undefined, record)
  }
  const resources = useMemo(() => {
    const result: SceneResources = {}
    for (const cue of scene?.cues ?? []) {
      const id = cue.resourceId ?? samples[cue.id]
      const video = overview?.videos.find(item => item.id === id)
      const clip = overview?.audio.find(item => item.id === id)
      if (video) result[cue.id] = { id: video.id, durationMs: video.durationMs ?? 10000, url: video.videoUrl ?? undefined, posterUrl: video.posterUrl ?? undefined, dimOpacity: scene?.event === 'birthday' ? 0 : 0.55 }
      else if (clip) result[cue.id] = { id: clip.id, durationMs: clip.durationMs, url: clip.source === 'birthday' ? `api/birthdays/assets/${encodeURIComponent(clip.id)}` : `api/animation/assets/${encodeURIComponent(clip.id)}`, checksum: clip.checksum }
      else if (!cue.resourceId && cue.binding !== 'resource') result[cue.id] = exampleResources[cue.id] ?? exampleResources[cue.slot] ?? (scene?.event !== 'birthday' ? overview?.defaultResources?.[cue.slot] : undefined)
      else if (cue.resourceId) result[cue.id] = Object.values(exampleResources).find(resource => resource?.id === cue.resourceId)
    }
    return result
  }, [scene, overview, samples, exampleResources])
  const timeline = useMemo(() => {
    try {
      return { ...(scene ? resolveSceneTimeline(scene, resources) : { cues: [], durationMs: 10000 }), error: '' }
    } catch (error) { return { cues: [], durationMs: 10000, error: (error as Error).message } }
  }, [scene, resources])
  const timingError = timeline.error
  const relatedIds = new Set(scene ? sceneLinks(scene, timeline.cues, cueId).flatMap(link => [link.source.id, link.target.id]) : [])
  const select = (id: string) => {
    preview.current?.pause()
    setCueId(id)
  }
  const editSettings = (next: EventSceneSettings, selectedId = templateId) => {
    if (templateActions.current) {
      templateActions.current.open = false
      templateActions.current.querySelector('summary')?.focus()
    }
    setNotice('')
    history.edit(() => next, { event, templateId: selectedId })
  }
  const save = async (use = false, replacement?: EventSceneSettings, message?: string) => {
    const source = replacement ?? settings
    if (!source || busy || (use && !scene)) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (timingError && !replacement) throw new Error(timingError)
      const input = validateEventScenes(use ? { ...source, selected: { ...source.selected, [event]: scene!.id } } : source)
      const next = await api.put<EventSceneSettings>('', { body: input })
      history.reset(next)
      setSaved(next)
      setNotice(message ?? (use ? 'Plantilla en uso.' : 'Coreografía guardada.'))
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  const choose = (resource: AnimationClip | TransitionVideo) => {
    if (!scene || !picker) return
    const video = 'videoUrl' in resource
    const lane = video ? 'background' : resource.kind === 'ambience' ? 'ambience' : 'voice'
    if (picker.replace) {
      const target = scene.cues.find(cue => cue.id === picker.replace)
      if (!target || target.lane !== lane) {
        setError('Seleccione un recurso de la misma pista.')
        return
      }
      changeCue(target.id, { resourceId: resource.id, label: resource.title })
    } else if (lane === 'ambience' && scene.cues.some(cue => cue.lane === 'ambience')) {
      const target = scene.cues.find(cue => cue.lane === 'ambience')!
      changeCue(target.id, { resourceId: resource.id, label: resource.title, enabled: true })
      setCueId(target.id)
      setNotice('Ambiente reemplazado.')
    } else {
      const id = crypto.randomUUID()
      const next: SceneCue = { ...sceneCue(lane === 'background' ? 'background' : lane === 'ambience' ? 'ambience' : 'announcement', lane, lane === 'voice' ? 'previous' : 'start'), id, binding: 'resource', resourceId: resource.id, label: resource.title }
      const cues = [...scene.cues]
      const index = lane === 'voice' ? Math.max(...cues.map((cue, index) => cue.lane === 'voice' ? index : -1)) + 1 : cues.length
      cues.splice(index, 0, next)
      update({ cues })
      setCueId(id)
    }
    setPicker(null)
  }
  const duplicateCue = () => {
    if (!scene || !cue) return
    if (cue.lane !== 'text' && !cue.resourceId) {
      setPicker({ video: cue.lane === 'background' })
      return
    }
    const id = crypto.randomUUID()
    const next = { ...cue, id, ...(cue.lane !== 'text' ? { binding: 'resource' as const } : {}), ...(cue.lane === 'voice' ? { anchor: 'block' as const, referenceId: cue.id, referenceEdge: 'end' as const, offsetMs: 0 } : {}), ...(cue.layout ? { layout: { ...cue.layout, y: Math.min(95, cue.layout.y + 3) } } : {}) }
    const cues = [...scene.cues]
    cues.splice(cues.findIndex(item => item.id === cue.id) + 1, 0, next)
    update({ cues })
    setCueId(id)
  }
  const example = async (id: string) => {
    const version = ++exampleVersion.current
    preview.current?.pause()
    setExampleId(id)
    if (!id) {
      setExampleResources({})
      setValues(defaults())
      return
    }
    try {
      const data = await api.get<ExampleData>(`examples/${encodeURIComponent(id)}`)
      if (version === exampleVersion.current) {
        setExampleResources(data.resources)
        setValues(data.values)
        setSamples({})
      }
    } catch (error) { if (version === exampleVersion.current) setError((error as Error).message) }
  }
  const refreshResources = () => {
    void api.get<Overview>('').then((data): void => {
      setOverview(data)
      setError('')
      setNotice('Recursos actualizados.')
      if (exampleId) void example(exampleId)
      return undefined
    }).catch(error => setError(error.message))
  }
  if (!settings || !overview) return (
    <section>
      <p role='status'>{error || 'Cargando coreografías…'}</p>
      {error && <Button variant='default' onClick={() => load()}>Reintentar</Button>}
    </section>
  )
  const inspector = cue && scene
    ? (
        <SceneInspector
          scene={scene}
          cue={cue}
          audio={audioChoices}
          videos={overview.videos}
          sample={samples[cue.id] ?? ''}
          change={patch => changeCue(cue.id, patch)}
          setSample={id => setSamples({ ...samples, [cue.id]: id })}
          replace={() => setPicker({ video: cue.lane === 'background', replace: cue.id })}
          duplicate={duplicateCue}
          remove={() => {
            const dependent = scene.cues.find(item => item.anchor === 'block' && item.referenceId === cue.id)
            if (dependent) {
              setError(`Cambie la referencia de «${sceneCueTitle(dependent)}» antes de quitar este bloque.`)
              return
            }
            update({ cues: scene.cues.filter(item => item.id !== cue.id) })
            setCueId(null)
            timelineContent.current?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
          }}
          split={() => {
            const next = splitSceneData(scene, cue.id)
            update({ cues: next.cues })
            setCueId(cue.id)
          }}
          move={(direction) => {
            const voices = scene.cues.filter(item => item.lane === 'voice')
            const index = voices.findIndex(item => item.id === cue.id)
            const other = voices[index + direction]
            if (!other) return
            const cues = [...scene.cues]
            const a = cues.findIndex(item => item.id === cue.id)
            const b = cues.findIndex(item => item.id === other.id)
            const value = cues[a]
            cues[a] = cues[b]
            cues[b] = value
            update({ cues })
          }}
        />
      )
    : <p>Seleccione un elemento del lienzo o de la línea de tiempo.</p>
  return (
    <section
      className={styles.editor}
      data-scene-editor
      aria-label='Coreografías'
      onKeyDown={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
        event.preventDefault()
        if (event.shiftKey) history.redo()
        else history.undo()
      }}
    >
      <div className={styles.editorHeader}>
        <label>
          Evento
          <select
            value={event}
            onChange={(e) => {
              const event = e.target.value as SceneEvent
              history.select(event, settings.templates.find(scene => scene.event === event)?.id ?? '')
              setCueId(null)
              void example('')
            }}
          >
            {sceneEvents.map(event => <option key={event} value={event}>{sceneEventLabels[event]}</option>)}
          </select>
        </label>
        <label>
          Plantilla
          <select
            value={templateId}
            onChange={(e) => {
              history.select(event, e.target.value)
              setCueId(null)
            }}
          >
            <option value='' disabled>Seleccionar</option>
            {settings.templates.filter(scene => scene.event === event).map(scene => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
                {settings.selected[event] === scene.id ? ' · En uso' : ''}
              </option>
            ))}
          </select>
        </label>
        <details
          className={styles.templateActions}
          ref={templateActions}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && templateActions.current) {
              templateActions.current.open = false
              templateActions.current.querySelector('summary')?.focus()
            }
          }}
        >
          <summary className={styles.iconDisclosure} aria-label='Acciones de plantilla'><Icon icon='MORE_HORIZ' size={22} /></summary>
          <div className={styles.actionMenu}>
            <Button
              variant='default'
              onClick={() => {
                const id = crypto.randomUUID()
                editSettings({ ...settings, templates: [...settings.templates, { ...splitSceneData(defaultEventScene(event), 'text'), id, name: 'Nueva coreografía' }] }, id)
                setCueId(null)
              }}
            >
              Nueva
            </Button>
            {scene && (
              <Button
                variant='default'
                onClick={() => {
                  const id = crypto.randomUUID()
                  editSettings({ ...settings, templates: [...settings.templates, { ...scene, id, name: `${scene.name} · Copia` }] }, id)
                }}
              >
                Duplicar plantilla
              </Button>
            )}
            {scene && (
              <Button
                variant='danger'
                onClick={() => {
                  const next = settings.templates.filter(item => item.id !== scene.id)
                  const selected = settings.selected[event] === scene.id ? { ...settings.selected, [event]: null } : settings.selected
                  editSettings({ ...settings, templates: next, selected }, next.find(item => item.event === event)?.id ?? '')
                  setCueId(null)
                }}
              >
                Eliminar plantilla
              </Button>
            )}
          </div>
        </details>
      </div>
      <div className={styles.saveBar} role='group' aria-label='Guardar coreografía'>
        <span role='status'>{busy ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Guardado'}</span>
        <div className={styles.saveActions}>
          <Button
            variant='default'
            disabled={!dirty || busy}
            onClick={() => {
              if (saved) history.reset(saved)
              setError('')
              setNotice('')
            }}
          >
            Descartar cambios
          </Button>
          <Button variant='primary' disabled={!dirty || busy} onClick={() => void save()}>Guardar</Button>
          {scene && <Button variant='default' disabled={busy} onClick={() => void save(true)}>Guardar y usar</Button>}
        </div>
      </div>
      {error && <p role='alert'>{error}</p>}
      {error.includes('recursos') && <Button variant='default' onClick={refreshResources}>Actualizar recursos</Button>}
      {error.includes('Recargue') && <Button variant='default' onClick={() => load(true)}>Recargar</Button>}
      {notice && <p role='status'>{notice}</p>}
      {!scene && <p role='status'>Cree o seleccione una plantilla para editar la escena.</p>}
      {scene && (
        <>
          <div className={`${styles.actions} ${styles.resourceTools}`}>
            <SceneIconButton label='Deshacer' icon='UNDO' disabled={!history.canUndo} onClick={history.undo} />
            <SceneIconButton label='Rehacer' icon='REDO' disabled={!history.canRedo} onClick={history.redo} />
            <Button variant='default' icon='PLUS' size={18} aria-label='Agregar audio' onClick={() => setPicker({ video: false })}>Audio</Button>
            <Button variant='default' icon='PLUS' size={18} aria-label='Agregar video' onClick={() => setPicker({ video: true })}>Video</Button>
            <Button
              variant='default'
              icon='PLUS'
              size={18}
              aria-label='Agregar texto'
              onClick={() => {
                const id = crypto.randomUUID()
                update({ cues: [...scene.cues, { ...sceneCue('text', 'text'), id, text: 'Nuevo texto', label: 'Texto', layout: defaultSceneTextLayout() }] })
                setCueId(id)
                preview.current?.pause()
              }}
            >
              Texto
            </Button>
            <label>
              Caso de prueba
              <select value={exampleId} onChange={e => void example(e.target.value)}>
                <option value=''>Datos de ejemplo</option>
                {examples.filter(item => item.event === event).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.workspace}>
            <ScenePreview
              ref={preview}
              scene={scene}
              resources={resources}
              values={values}
              editing={{ selectedId: cueId, select, change: changeCue, fit: (id, y) => {
                const cue = scene.cues.find(cue => cue.id === id)
                if (cue?.layout) changeCue(id, { layout: { ...cue.layout, y } }, false)
              }, begin: history.begin, end: history.end }}
              onError={setError}
              onTime={setTime}
            />
            <SceneTiming key={`${scene.id}:${cue?.id}`} scene={scene} cue={cue} resolved={timeline.cues.some(item => item.id === cue?.id)} change={patch => cue && changeCue(cue.id, patch)} />
            <div className={`${styles.actions} ${styles.timelineTools}`}>
              <label>
                Zoom
                <select value={zoom} onChange={e => setZoom(Number(e.target.value))}>
                  <option value={1}>100 %</option>
                  <option value={2}>200 %</option>
                  <option value={4}>400 %</option>
                </select>
              </label>
              <label className={styles.check}>
                <input type='checkbox' checked={snap} onChange={e => setSnap(e.target.checked)} />
                Ajustar a 0,1 s
              </label>
            </div>
            {timingError && <p role='alert'>{timingError}</p>}
            <div className={styles.timeline} role='group' aria-label='Línea de tiempo'>
              <div ref={timelineContent} className={styles.timelineContent} style={{ minWidth: 640 * zoom }}>
                <SceneLinks scene={scene} resolved={timeline.cues} selectedId={cueId} container={timelineContent} select={select} />
                <div className={styles.ruler}>
                  {Array.from({ length: 11 }, (_, index) => <button key={index} onClick={() => preview.current?.seek(timeline.durationMs * index / 10)}>{(timeline.durationMs * index / 10000).toFixed(1)}</button>)}
                  <span
                    className={styles.cursorHandle}
                    role='slider'
                    tabIndex={0}
                    aria-label='Cursor de la línea de tiempo'
                    aria-valuemin={0}
                    aria-valuemax={timeline.durationMs / 1000}
                    aria-valuenow={time / 1000}
                    style={{ left: `${time / timeline.durationMs * 100}%` }}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                      event.preventDefault()
                      preview.current?.seek(event.key === 'Home' ? 0 : event.key === 'End' ? timeline.durationMs : time + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1000 : 100))
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      preview.current?.pause()
                      const node = event.currentTarget
                      const rect = node.parentElement!.getBoundingClientRect()
                      node.setPointerCapture(event.pointerId)
                      const move = (event: PointerEvent) => preview.current?.seek((event.clientX - rect.left) / rect.width * timeline.durationMs)
                      const end = () => {
                        node.removeEventListener('pointermove', move)
                        node.removeEventListener('pointerup', end)
                        node.removeEventListener('pointercancel', end)
                      }
                      node.addEventListener('pointermove', move)
                      node.addEventListener('pointerup', end)
                      node.addEventListener('pointercancel', end)
                    }}
                  />
                </div>
                {Object.entries(lanes).map(([lane, label]) => {
                  const items = scene.cues.filter(cue => cue.lane === lane)
                  const timedItems = items.filter(item => timeline.cues.some(cue => cue.id === item.id))
                  const pendingItems = items.filter(item => !timeline.cues.some(cue => cue.id === item.id))
                  const stack = timelineRows(timedItems, timeline.cues)
                  return (
                    <div className={styles.row} key={lane}>
                      <span className={styles.laneLabel} data-timeline-lane={lane}>{label}</span>
                      <div className={styles.laneBody}>
                        <div
                          className={styles.track}
                          style={{ height: `${stack.count * 4}rem` }}
                          onPointerDown={(e) => {
                            if (e.target !== e.currentTarget) return
                            const rect = e.currentTarget.getBoundingClientRect()
                            preview.current?.seek((e.clientX - rect.left) / rect.width * timeline.durationMs)
                          }}
                        >
                          {timedItems.map((item) => {
                            const timing = timeline.cues.find(cue => cue.id === item.id)
                            return (
                              <button
                                type='button'
                                key={item.id}
                                className={styles.block}
                                aria-pressed={item.id === cueId}
                                data-timeline-cue={item.id}
                                data-related={relatedIds.has(item.id)}
                                data-muted={!sceneCueEnabled(item)}
                                style={{ top: `${stack.positions[item.id] * 4 + 1.2}rem`, bottom: 'auto', height: '2.6rem', left: `${(timing?.startMs ?? 0) / timeline.durationMs * 100}%`, width: `${Math.max(4, ((timing?.endMs ?? 500) - (timing?.startMs ?? 0)) / timeline.durationMs * 100)}%` }}
                                onClick={() => select(item.id)}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return
                                  select(item.id)
                                  const node = e.currentTarget
                                  const rect = node.parentElement!.getBoundingClientRect()
                                  const x = e.clientX
                                  const resize = item.lane !== 'voice' && e.clientX > node.getBoundingClientRect().right - 12
                                  history.begin()
                                  node.setPointerCapture(e.pointerId)
                                  const move = (event: PointerEvent) => {
                                    const delta = (event.clientX - x) / rect.width * timeline.durationMs
                                    const round = (value: number) => Math.round(value / (snap ? 100 : 1)) * (snap ? 100 : 1)
                                    changeCue(item.id, resize ? { durationMs: Math.max(100, Math.min(360000, round((timing ? timing.endMs - timing.startMs : 1000) + delta))) } : { offsetMs: Math.max(item.anchor === 'block' ? -30000 : 0, Math.min(30000, round(item.offsetMs + delta))) })
                                  }
                                  const end = () => {
                                    node.removeEventListener('pointermove', move)
                                    node.removeEventListener('pointerup', end)
                                    node.removeEventListener('pointercancel', end)
                                    history.end()
                                  }
                                  node.addEventListener('pointermove', move)
                                  node.addEventListener('pointerup', end)
                                  node.addEventListener('pointercancel', end)
                                }}
                              >
                                <span className={styles.dragHandle} aria-hidden='true'>⋮</span>
                                {sceneCueTitle(item)}
                                {item.lane !== 'voice' && <span className={styles.durationHandle} aria-hidden='true' />}
                              </button>
                            )
                          })}
                          <span className={styles.playhead} style={{ left: `${time / timeline.durationMs * 100}%` }} aria-hidden='true' />
                          {scene.startOffsetMs < 0 && <span data-scene-end-marker aria-hidden='true' style={{ left: `${-scene.startOffsetMs / timeline.durationMs * 100}%` }} />}
                        </div>
                        {!!pendingItems.length && (
                          <div className={styles.pendingCues} data-unresolved-cues>
                            <span>Sin tiempos de prueba</span>
                            {pendingItems.map(item => (
                              <button key={item.id} data-timeline-cue={item.id} data-related={relatedIds.has(item.id)} data-muted={!sceneCueEnabled(item)} aria-pressed={item.id === cueId} onClick={() => select(item.id)}>{sceneCueTitle(item)}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <aside className={styles.inspector}>{inspector}</aside>
          </div>
          <details className={styles.sceneSettings}>
            <summary>Plantilla y datos de prueba</summary>
            <div className={styles.numberGrid}>
              <label>
                Nombre de plantilla
                <input type='text' value={scene.name} maxLength={80} onChange={e => update({ name: e.target.value })} />
              </label>
              <SceneNumber label='Inicio respecto al final del video (s)' value={scene.startOffsetMs / 1000} min={-10} max={10} step={0.1} onChange={value => update({ startOffsetMs: value * 1000 })} />
              <SceneNumber label='Salida visual (s)' value={scene.exitMs / 1000} min={0} max={3} step={0.1} onChange={value => update({ exitMs: value * 1000 })} />
              {(['name', 'table', 'song', 'venue', 'message', 'sender'] as const).map((key, index) => (
                <label key={key}>
                  {['Nombre de prueba', 'Mesa de prueba', 'Canción de prueba', 'Local de prueba', 'Saludo de prueba', 'Remitente de prueba'][index]}
                  <input type='text' value={values[key] ?? ''} maxLength={300} onChange={e => setValues({ ...values, [key]: e.target.value })} />
                </label>
              ))}
            </div>
            <label className={styles.check}>
              <input type='checkbox' checked={scene.continueBed} onChange={e => update({ continueBed: e.target.checked })} />
              Mantener ambiente hasta la siguiente canción
            </label>
            <div className={styles.actions}>
              {settings.selected[event] && <Button variant='default' onClick={() => void save(false, { ...settings, selected: { ...settings.selected, [event]: null } }, 'Se usa la transición original.')}>Usar original</Button>}
            </div>
          </details>
        </>
      )}
      {picker && <SceneResourcePicker video={picker.video} audio={audioChoices} videos={overview.videos} choose={choose} close={() => setPicker(null)} refresh={refreshResources} />}
    </section>
  )
}
