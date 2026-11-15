import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { birthdayLabels, birthdayLimits, birthdayPhases, birthdayTimeline, type BirthdayAsset, type BirthdaySettings, type BirthdayPhase } from 'shared/birthdays'
import { birthdayPreviewScript } from 'shared/birthdayPreview'
import { replaceBirthdayPreviewName } from 'shared/birthdayGreeting'
import type { BirthdayPreviewAsset, BirthdayPreviewState } from 'shared/birthdayPreview'
import { birthdayPreviewMemory } from 'lib/birthdayPreviewMemory'
import { useAppSelector } from 'store/hooks'
import BirthdayPresentation from './BirthdayPresentation'
import { birthdayApi, birthdayUrl } from './api'
import styles from './BirthdayCelebration.css'
import { BirthdayAudio } from '../../routes/Player/components/Birthday/BirthdayAudio'

export default function BirthdayCelebrationPreview ({ config, assets, onClose }: { config: BirthdaySettings, assets: BirthdayAsset[], onClose(): void }) {
  const { roomId } = useAppSelector(state => state.user)
  const entry = birthdayPreviewMemory.room(roomId!, config, {
    load: () => birthdayApi.get<BirthdayPreviewState>(`preview/${roomId}`),
    save: (draft, revision) => birthdayApi.put<{ revision: number }>(`preview/${roomId}`, { body: { draft, revision }, keepalive: true }),
  })
  const { draft, busy, error, saving } = useSyncExternalStore(entry.subscribe, entry.getSnapshot)
  const { name, script, introId, videoId, musicId, bedId, bedVolume, profileIndex, applauseId } = draft
  const setIntroId = (introId: string) => entry.update({ introId })
  const setVideoId = (videoId: string) => entry.update({ videoId })
  const setMusicId = (musicId: string) => entry.update({ musicId })
  const greeting = entry.sample(config)
  const selected = [
    assets.find(asset => asset.kind === 'intro' && asset.id === introId),
    greeting,
    assets.find(asset => asset.kind === 'music' && asset.id === musicId),
    assets.find(asset => asset.kind === 'video' && asset.id === videoId),
    assets.find(asset => asset.kind === 'bed' && asset.id === bedId),
    assets.find(asset => asset.kind === 'applause' && asset.id === applauseId),
  ].filter((asset): asset is BirthdayAsset => !!asset)
  const generate = (regenerate = false) => entry.generate(config, (body, signal) => birthdayApi.post<BirthdayPreviewAsset>('audition', { signal, body: { ...body, previewRoomId: roomId } }), regenerate)

  return (
    <Modal title='Previsualizar cumpleaños' className={styles.previewDialog} scrollable onClose={onClose}>
      <PreviewPlayer key={JSON.stringify([name, selected.map(asset => asset.id), busy, bedVolume])} name={name} assets={selected} busy={busy} bedVolume={bedVolume} />
      <fieldset className={styles.variants} disabled={busy}>
        <legend>Variantes</legend>
        {([
          ['intro', 'Introducción', introId, setIntroId],
          ['video', 'Video de fondo', videoId, setVideoId],
          ['music', 'Música final', musicId, setMusicId],
        ] as const).map(([kind, label, value, change]) => (
          <label key={kind}>
            {label}
            <select value={value} onChange={event => change(event.target.value)}>
              <option value=''>Seleccionar…</option>
              {assets.filter(asset => asset.kind === kind).map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
            </select>
          </label>
        ))}
        <label>
          Audio de fondo
          <select value={bedId} onChange={event => entry.update({ bedId: event.target.value })}>
            <option value=''>Sin fondo</option>
            {assets.filter(asset => asset.kind === 'bed').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
          </select>
        </label>
        <label>
          Volumen del fondo (%)
          <input type='number' min={0} max={100} value={Math.round(bedVolume * 100)} onChange={event => entry.update({ bedVolume: event.target.valueAsNumber / 100 })} />
        </label>
        <label>
          Aplauso de cierre
          <select value={applauseId ?? ''} onChange={event => entry.update({ applauseId: event.target.value })}>
            <option value=''>Sin aplauso</option>
            {assets.filter(asset => asset.kind === 'applause').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
          </select>
        </label>
        <label>
          Perfil de redacción
          <select
            value={profileIndex}
            onChange={(event) => {
              entry.update({ profileIndex: event.target.value })
            }}
          >
            <option value=''>Voz predeterminada</option>
            {config.rules.map((rule, index) => <option key={rule.id ?? index} value={index}>{rule.title || `Perfil ${index + 1}`}</option>)}
          </select>
        </label>
        <label>
          Nombre de prueba
          <input
            type='text'
            value={name}
            maxLength={60}
            onChange={(event) => {
              const next = event.target.value
              entry.update({ name: next, script: !name || script === birthdayPreviewScript(name) ? birthdayPreviewScript(next) : replaceBirthdayPreviewName(script, name, next) })
            }}
          />
        </label>
        <label className={styles.sampleScript}>
          Saludo de prueba
          <textarea
            rows={4}
            maxLength={birthdayLimits.script}
            value={script}
            onChange={(event) => {
              entry.update({ script: event.target.value })
            }}
          />
        </label>
        <div className={styles.actions}>
          <Button variant='primary' onClick={() => void generate()}>Generar audio</Button>
          <Button onClick={() => void generate(true)}>Generar otro saludo</Button>
        </div>
      </fieldset>
      {error && <p role='alert'>{error}</p>}
      {saving && <p role='status'>Guardando previsualización…</p>}
      <div className={styles.actions}><Button onClick={onClose}>Cerrar previsualización</Button></div>
    </Modal>
  )
}

function PreviewPlayer ({ name, assets, busy, bedVolume }: { name: string, assets: BirthdayAsset[], busy: boolean, bedVolume: number }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [finished, setFinished] = useState(false)
  const [run, setRun] = useState(0)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState(false)
  const [audible, setAudible] = useState(false)
  const [warning, setWarning] = useState('')
  const [started, setStarted] = useState(false)
  const [visualPhase, setVisualPhase] = useState<BirthdayPhase>('prelude')
  const audio = useRef<HTMLAudioElement>(null)
  const background = useRef<{ context: AudioContext, mix: BirthdayAudio, controller: AbortController, prepared: Promise<void>, timed?: { index: number, end: number, promise: Promise<void> } } | null>(null)
  const ready = birthdayPhases.every(phase => assets.some(asset => asset.kind === phase)) && assets.some(asset => asset.kind === 'video')
  const sequence = useMemo(() => ready ? birthdayTimeline(assets, 1) : [], [ready, assets])
  const selected = sequence[index]
  const src = selected?.asset ? birthdayUrl(selected.asset.url) : undefined
  const missing = [['intro', 'introducción'], ['video', 'video de fondo'], ['music', 'música final']].filter(([kind]) => !assets.some(asset => asset.kind === kind)).map(([, label]) => label)

  const dispose = () => {
    const previous = background.current
    background.current = null
    previous?.controller.abort()
    previous?.mix.stop()
    if (previous) void previous.context.close()
  }
  useEffect(() => () => {
    const previous = background.current
    previous?.controller.abort()
    previous?.mix.stop()
    if (previous) void previous.context.close()
  }, [])

  useEffect(() => {
    const element = audio.current
    let active = true
    if (playing && selected) void (async () => {
      if (!background.current) {
        const context = new AudioContext()
        const mix = new BirthdayAudio(context, true, 1)
        const controller = new AbortController()
        background.current = { context, mix, controller, prepared: mix.prepare(assets, controller.signal, bedVolume) }
      }
      const current = background.current
      await current.context.resume()
      await current.prepared
      if (!active || current.controller.signal.aborted) return
      current.mix.permitFor(600000)
      const remainingMs = src
        ? selected.durationMs - (element?.currentTime ?? 0) * 1000
        : current.timed?.index === index ? Math.max(0, (current.timed.end - current.context.currentTime) * 1000) : selected.durationMs
      current.mix.backgroundPhase(selected.phase, 1, remainingMs, current.controller.signal)
      setWarning(current.mix.warning)
      if (!selected.asset || (selected.phase === 'applause' && !current.mix.available(selected.asset))) {
        setVisualPhase(selected.phase)
        if (!current.timed || current.timed.index !== index) current.timed = { index, end: current.context.currentTime + selected.durationMs / 1000, promise: current.mix.wait(selected.asset ? 0 : selected.durationMs, current.controller.signal) }
        await current.timed.promise
        if (active) {
          if (index + 1 < sequence.length) setIndex(index + 1)
          else {
            setPlaying(false)
            setFinished(true)
          }
        }
        return
      }
      if (element) current.mix.mediaPhase(selected.asset, element)
      await element?.play()
      if (active) setAudible(true)
    })().catch(() => {
      if (active) {
        background.current?.mix.stopBed()
        setPlaying(false)
        setError('No se pudo iniciar el audio. Pulse Reproducir para reintentar.')
      }
    })
    else {
      element?.pause()
      const context = background.current?.context
      if (context?.state === 'running') void context.suspend()
    }
    return () => {
      active = false
      element?.pause()
    }
  }, [src, playing, run, selected, assets, bedVolume, index, sequence.length])

  const start = (phase = 0) => {
    dispose()
    setAudible(false)
    setVisualPhase('prelude')
    setStarted(true)
    audio.current?.pause()
    if (audio.current) audio.current.currentTime = 0
    setIndex(phase)
    setFinished(false)
    setError('')
    setRun(value => value + 1)
    setPlaying(true)
  }
  return (
    <>
      <div className={styles.stage}>{(!started || selected?.phase !== 'prelude') && <BirthdayPresentation key={run} name={name} video={assets.find(asset => asset.kind === 'video')} phase={visualPhase} playing={playing && audible} onVideoError={() => setVideoError(true)} />}</div>
      <p className={styles.status} role='status'>{finished ? 'Previsualización finalizada' : selected ? birthdayLabels[selected.phase] : 'Previsualización en este dispositivo'}</p>
      {busy && <p role='status'>Generando saludo de prueba…</p>}
      {!assets.some(asset => asset.kind === 'greeting') && !busy && <p role='status'>Genere el audio para probar el saludo con este nombre, texto y voz.</p>}
      {!!missing.length && <p role='status'>{`Seleccione ${missing.join(', ')}. Si no hay variantes, agréguelas en Configuración.`}</p>}
      {videoError && <p role='status'>No se pudo abrir el fondo. Revise el video en Configuración.</p>}
      {error && <p role='alert'>{error}</p>}
      {warning && <p role='status'>{warning}</p>}
      <audio
        key={run}
        ref={audio}
        src={src}
        preload='auto'
        onPlaying={(event) => {
          if (selected?.asset) {
            background.current?.mix.mediaPhase(selected.asset, event.currentTarget)
            setVisualPhase(selected.phase)
          }
        }}
        onSeeked={(event) => {
          if (selected?.asset) background.current?.mix.mediaPhase(selected.asset, event.currentTarget)
        }}
        onError={() => {
          if (!src) return
          background.current?.mix.stopBed()
          if (selected?.phase === 'applause') {
            setWarning('No se pudo reproducir el aplauso. La previsualización finalizó.')
            setPlaying(false)
            setFinished(true)
            return
          }
          setPlaying(false)
          setError('No se pudo abrir el audio. Revise el recurso en Configuración.')
        }}
        onEnded={() => {
          if (!playing) return
          if (index + 1 < sequence.length) setIndex(index + 1)
          else {
            setPlaying(false)
            setFinished(true)
          }
        }}
      />
      <div className={styles.actions}>
        <Button
          variant='primary'
          disabled={!ready || busy}
          onClick={() => {
            setError('')
            if (finished) start()
            else {
              setStarted(true)
              setPlaying(value => !value)
            }
          }}
        >
          {playing ? 'Pausar' : 'Reproducir'}
        </Button>
        <Button disabled={!ready || busy} onClick={() => start()}>Reiniciar</Button>
        <label className={styles.phase}>
          Probar desde
          <select value={index} disabled={!ready || busy} onChange={event => start(Number(event.target.value))}>
            {sequence.map((step, phaseIndex) => <option key={step.phase} value={phaseIndex}>{birthdayLabels[step.phase]}</option>)}
          </select>
        </label>
      </div>
    </>
  )
}
