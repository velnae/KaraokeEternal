import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Icon from 'components/Icon/Icon'
import { resolveSceneTimeline, sceneCueEnabled, sceneCueTitle, sceneResource, type EventScene, type SceneResources } from 'shared/eventScenes'
import PlayerTransitionPresentation from 'routes/Player/components/Animation/PlayerTransitionPresentation'
import BirthdayRecognition from 'components/Birthdays/BirthdayRecognition'
import SceneLayers, { type SceneEditing } from './SceneLayers'
import SceneBackgrounds from './SceneBackgrounds'
import SceneCanvas from './SceneCanvas'
import PrivateSceneAudio from './PrivateSceneAudio'
import SceneIconButton from './SceneIconButton'
import screenfull from 'screenfull'
import { previewQueueItem, previewGreeting } from './previewData'
import styles from './Scenes.css'

export interface ScenePreviewHandle { seek(timeMs: number): void, pause(): void }
interface Props {
  scene: EventScene
  resources: SceneResources
  values: Record<string, string>
  editing: SceneEditing
  onError(message: string): void
  onTime(timeMs: number): void
}
const ScenePreview = forwardRef<ScenePreviewHandle, Props>(function ScenePreview ({ scene, resources, values, editing, onError, onTime }, ref) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [visualOnly, setVisualOnly] = useState(false)
  const [resolution, setResolution] = useState(1920)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const panel = useRef<HTMLElement>(null)
  const wasFullscreen = useRef(false)
  const clock = useRef({ time: 0, origin: 0, visual: false, playing: false })
  const audio = useRef<PrivateSceneAudio | null>(null)
  const version = useRef(0)
  const timeline = useMemo(() => {
    try {
      return { ...resolveSceneTimeline(scene, resources), error: '' }
    } catch (error) { return { cues: [], durationMs: 10000, error: (error as Error).message } }
  }, [scene, resources])
  const missing = scene.cues.filter(cue => cue.lane === 'voice' && sceneCueEnabled(cue) && (cue.binding === 'resource' || scene.event === 'birthday' || cue.slot === 'announcement') && !sceneResource(cue, resources)?.url && !sceneResource(cue, resources)?.parts?.length)
  const onlyImages = visualOnly && missing.length > 0
  const reportError = (message: string) => {
    setPreviewError(message)
    onError(message)
  }
  const toggleFullscreen = async () => {
    setFullscreenError('')
    const node = panel.current
    if (!node || !screenfull.isEnabled) {
      setFullscreenError('Este navegador no admite pantalla completa. Continúe en la vista del editor.')
      return
    }
    try {
      if (screenfull.element === node) await screenfull.exit()
      else await screenfull.request(node)
    } catch {
      setFullscreenError('No se pudo cambiar la pantalla completa. Vuelva a intentarlo desde el botón.')
    }
  }
  useEffect(() => {
    const node = panel.current
    const api = screenfull
    if (!node || !api.isEnabled) return
    const update = () => {
      const active = api.element === node
      setFullscreen(active)
      if (wasFullscreen.current && !active) node.querySelector<HTMLButtonElement>('[data-preview-fullscreen-toggle]')?.focus({ preventScroll: true })
      wasFullscreen.current = active
    }
    api.on('change', update)
    return () => {
      api.off('change', update)
      if (api.element === node) void api.exit().catch(() => {})
    }
  }, [])
  const updateTime = (value: number) => {
    clock.current.time = value
    setTime(value)
    onTime(value)
  }
  const pause = () => {
    version.current++
    if (clock.current.playing) updateTime(Math.min(timeline.durationMs, clock.current.visual ? performance.now() - clock.current.origin : audio.current?.position() ?? time))
    clock.current.playing = false
    audio.current?.stop()
    setPlaying(false)
    setLoading(false)
  }
  const play = async (position = clock.current.time) => {
    if (timeline.error) {
      reportError(timeline.error)
      return
    }
    if (missing.length && !onlyImages) {
      reportError(`Seleccione una muestra para ${sceneCueTitle(missing[0])}, o active Solo imagen.`)
      return
    }
    const token = ++version.current
    reportError('')
    setLoading(true)
    try {
      if (!onlyImages) {
        if (!audio.current) audio.current = new PrivateSceneAudio()
        await audio.current.resume()
        if (!await audio.current.prepare(timeline.cues) || token !== version.current) return
        audio.current.start(timeline.cues, position)
      }
      if (token !== version.current) return
      clock.current = { time: position, origin: performance.now() - position, visual: onlyImages, playing: true }
      setPlaying(true)
    } catch (error) {
      reportError((error as Error).message)
    } finally { if (token === version.current) setLoading(false) }
  }
  const seek = (position: number) => {
    const resume = clock.current.playing
    pause()
    const target = Math.max(0, Math.min(timeline.durationMs, position))
    updateTime(target)
    if (resume && target < timeline.durationMs) void play(target)
  }
  useImperativeHandle(ref, () => ({ seek, pause }))
  useEffect(() => {
    pause()
    updateTime(Math.min(clock.current.time, timeline.durationMs))
    // Editing captures a new composition; it pauses rather than publishing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, resources])
  useEffect(() => {
    if (!playing) return
    let frame: number
    const tick = () => {
      const position = clock.current.visual ? performance.now() - clock.current.origin : audio.current?.position() ?? 0
      updateTime(Math.min(position, timeline.durationMs))
      if (position >= timeline.durationMs) pause()
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline.durationMs])
  useEffect(() => () => {
    version.current++
    audio.current?.close()
  }, [])
  const greetingTime = timeline.cues.find(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === 'greeting')?.startMs
    ?? timeline.cues.find(cue => cue.lane === 'voice' && cue.binding !== 'resource' && cue.slot === 'announcement')?.startMs ?? 0
  const visibleValues = time >= greetingTime ? values : { ...values, message: '', sender: '' }
  const native = scene.event === 'birthday'
    ? <BirthdayRecognition name={values.name ?? ''} />
    : (
        <PlayerTransitionPresentation incoming={previewQueueItem(scene.event, values)} venueName={values.venue ?? ''} greeting={previewGreeting(visibleValues)} onGreetingMounted={() => {}} />
      )
  const playLabel = loading ? 'Cancelar carga' : playing ? 'Pausar' : time > 0 && time < timeline.durationMs ? 'Continuar' : 'Previsualizar'
  return (
    <section
      ref={panel}
      aria-label='Vista previa de la coreografía'
      className={styles.previewPanel}
      data-preview-fullscreen={fullscreen}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && screenfull.isEnabled && screenfull.element === panel.current) {
          event.preventDefault()
          void screenfull.exit().catch(() => setFullscreenError('Use el control del navegador para salir de pantalla completa.'))
        }
      }}
    >
      <div className={styles.previewStage}>
        <SceneCanvas resolution={resolution}>
          <SceneBackgrounds cues={timeline.cues} elapsedMs={time} playing={playing} onError={() => reportError('No se pudo abrir un fondo. Seleccione otro video o revise su biblioteca.')} />
          <SceneLayers
            cues={timeline.cues}
            elapsedMs={time}
            values={visibleValues}
            fill={scene.event !== 'birthday'}
            editing={playing || fullscreen ? undefined : editing}
            greeting={visibleValues.message ? { id: 1, message: visibleValues.message, sender: visibleValues.sender ?? '' } : undefined}
          >
            {native}
          </SceneLayers>
        </SceneCanvas>
      </div>
      <div className={styles.transport}>
        <SceneIconButton label={playLabel} variant='primary' icon={loading ? 'CLEAR' : playing ? 'PAUSE' : 'PLAY'} onClick={() => playing || loading ? pause() : void play(time >= timeline.durationMs ? 0 : time)} />
        <SceneIconButton
          label='Detener'
          icon='STOP'
          onClick={() => {
            pause()
            updateTime(0)
          }}
        />
        <SceneIconButton label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} icon={fullscreen ? 'FULLSCREEN_EXIT' : 'FULLSCREEN'} data-preview-fullscreen-toggle onClick={() => void toggleFullscreen()} />
        <output aria-label='Tiempo de la vista previa'>
          {(time / 1000).toFixed(1)}
          {' '}
          /
          {' '}
          {(timeline.durationMs / 1000).toFixed(1)}
          {' '}
          s
        </output>
        <details className={styles.viewOptions}>
          <summary className={styles.iconDisclosure} aria-label='Opciones de vista'><Icon icon='TUNE' size={22} /></summary>
          <label>
            Resolución
            <select value={resolution} onChange={e => setResolution(Number(e.target.value))}>
              <option value={1280}>HD</option>
              <option value={1920}>Full HD</option>
              <option value={3840}>4K</option>
            </select>
          </label>
        </details>
      </div>
      <input aria-label='Posición de la vista previa' type='range' min={0} max={timeline.durationMs} step={100} value={time} onChange={e => seek(e.target.valueAsNumber)} />
      {loading && <p role='status'>Preparando los audios de prueba…</p>}
      {!!missing.length && (
        <label className={styles.check}>
          <input
            type='checkbox'
            checked={visualOnly}
            onChange={(e) => {
              pause()
              setVisualOnly(e.target.checked)
            }}
          />
          Solo imagen
        </label>
      )}
      {!!missing.length && !visualOnly && (
        <p role='status'>
          Falta una muestra:
          {missing.map(sceneCueTitle).join(', ')}
          .
        </p>
      )}
      {fullscreenError && <p role='alert'>{fullscreenError}</p>}
      {fullscreen && previewError && <p role='alert'>{previewError}</p>}
    </section>
  )
})
export default ScenePreview
