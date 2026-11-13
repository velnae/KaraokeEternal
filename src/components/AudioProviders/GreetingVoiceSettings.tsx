import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { defaultGreetingVoiceConfig, greetingVoiceModels, greetingVoiceSample, greetingVoiceStateLabels, type GreetingVoiceConfig, type GreetingVoiceSnapshot } from 'shared/greetingVoice'
import VoiceSelect from './VoiceSelect'
import useProviderVoices from './useProviderVoices'
import styles from '../Animation/GreetingVoiceSettings.css'

const api = new HttpApi('prefs/greeting-voice')

export default function GreetingVoiceSettings () {
  const id = useId()
  const [snapshot, setSnapshot] = useState<GreetingVoiceSnapshot | null>(null)
  const [draft, setDraft] = useState<GreetingVoiceConfig>({ ...defaultGreetingVoiceConfig })
  const [dirty, setDirty] = useState(false)
  const edited = useRef(false)
  const sequence = useRef(0)
  const mounted = useRef(false)
  const operation = useRef<AbortController | null>(null)
  const previewURL = useRef('')
  const [preview, setPreview] = useState('')
  const [pendingAction, setPendingAction] = useState<'save' | 'check' | 'reload' | 'preview' | null>(null)
  const busy = pendingAction !== null
  const [previewError, setPreviewError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const catalogue = useProviderVoices({ providerId: 'gemini', use: 'greetings', model: draft.model, enabled: !!snapshot?.configured })

  useEffect(() => {
    mounted.current = true
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const load = async () => {
      const version = ++sequence.current
      try {
        const result = await api.get<GreetingVoiceSnapshot>('', { signal: controller.signal })
        if (!alive || version !== sequence.current) return
        setSnapshot(result)
        if (!edited.current) setDraft(result.config)
      } catch (error) {
        if (alive && version === sequence.current) setError((error as Error).message)
      } finally {
        if (alive) timer = setTimeout(() => void load(), 2000)
      }
    }
    void load()
    return () => {
      alive = false
      mounted.current = false
      controller.abort()
      operation.current?.abort()
      URL.revokeObjectURL(previewURL.current)
      clearTimeout(timer)
    }
  }, [])

  const change = (patch: Partial<GreetingVoiceConfig>) => {
    edited.current = true
    setDirty(true)
    setNotice('')
    setDraft(value => ({ ...value, ...patch }))
  }
  const execute = async (action: 'save' | 'check' | 'reload' | 'preview') => {
    if (busy) return
    sequence.current++
    setPendingAction(action)
    setError('')
    setPreviewError('')
    setNotice('')
    const controller = new AbortController()
    operation.current = controller
    const timeout = setTimeout(() => controller.abort(), 120000)
    try {
      if (action === 'preview') {
        URL.revokeObjectURL(previewURL.current)
        previewURL.current = ''
        setPreview('')
        const response = await api.post<Response>('/preview', { signal: controller.signal })
        const blob = await response.blob()
        if (!mounted.current) return
        URL.revokeObjectURL(previewURL.current)
        previewURL.current = URL.createObjectURL(blob)
        setPreview(previewURL.current)
        return
      }
      const result = action === 'save'
        ? await api.put<GreetingVoiceSnapshot>('', { body: draft, signal: controller.signal })
        : action === 'reload'
          ? await api.get<GreetingVoiceSnapshot>('', { signal: controller.signal })
          : await api.post<GreetingVoiceSnapshot>('/check', { signal: controller.signal })
      if (!mounted.current) return
      sequence.current++
      setSnapshot(result)
      if (action === 'save' || action === 'reload') {
        edited.current = false
        setDirty(false)
        setDraft(result.config)
        URL.revokeObjectURL(previewURL.current)
        previewURL.current = ''
        setPreview('')
      }
      if (action === 'save') setNotice('Configuración guardada.')
      if (action === 'check') setNotice('Conexión y modelo verificados. No se generó audio.')
    } catch (error) {
      if (mounted.current) {
        const message = controller.signal.aborted ? 'La operación no se confirmó a tiempo. Revise el estado antes de volver a generar.' : (error as Error).message
        if (action === 'preview') setPreviewError(message)
        else setError(message)
      }
    } finally {
      clearTimeout(timeout)
      if (operation.current === controller) operation.current = null
      if (mounted.current) setPendingAction(null)
    }
  }

  const changedElsewhere = !!snapshot && dirty && draft.revision !== snapshot.config.revision
  const processing = snapshot?.state === 'generating' || snapshot?.state === 'checking'
  let help = 'Guardar ajusta la generación para todas las salas. La clave se configura exclusivamente en el servidor.'
  if (!snapshot) help = 'Cargando ajustes. Si la conexión falla, pulse Recargar ajustes.'
  else if (busy) help = 'Esperando la respuesta del servidor…'
  else if (changedElsewhere) help = 'Los ajustes cambiaron en otra sesión. Recargue antes de guardar.'
  else if (dirty) help = 'Guarde los cambios antes de comprobar la conexión o generar una prueba.'
  let previewHelp = ''
  if (!snapshot) previewHelp = 'Cargando ajustes. Si la conexión falla, pulse Recargar ajustes.'
  else if (pendingAction === 'preview') previewHelp = 'Preparando el audio de prueba…'
  else if (busy) previewHelp = 'Espere a que termine la operación actual.'
  else if (changedElsewhere) previewHelp = 'Los ajustes cambiaron en otra sesión. Pulse Recargar ajustes.'
  else if (dirty) previewHelp = 'Pulse Guardar ajustes para probar la voz con sus cambios.'
  else if (!snapshot.configured) previewHelp = 'Configure KES_GEMINI_API_KEY en el servidor para generar la prueba.'
  else if (snapshot.state === 'limited' || snapshot.state === 'error') previewHelp = snapshot.message
  else if (processing) previewHelp = 'Gemini está ocupado. La prueba se habilitará al terminar la operación actual.'

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.heading}>
        <h2 id={`${id}-title`}>Saludos de participantes</h2>
        <p>Todas las salas</p>
      </header>
      <div className={styles.status} data-state={snapshot?.state} role='status'>
        <strong>{snapshot ? greetingVoiceStateLabels[snapshot.state] : error ? 'No se pudieron cargar los ajustes' : 'Cargando ajustes…'}</strong>
        <p>{snapshot?.message}</p>
        {snapshot && (
          <>
            <p>{`Solicitudes de esta instalación: ${snapshot.usage.day} / ${snapshot.config.requestsPerDay} hoy · ${snapshot.usage.minute} / ${snapshot.config.requestsPerMinute} en el último minuto.`}</p>
            <small>{`Reinicio diario: ${new Date(snapshot.usage.resetsAt).toLocaleString()}. Otros usos del proyecto de Google también pueden consumir cuota.`}</small>
          </>
        )}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void execute('save')
        }}
      >
        <label className={styles.check}>
          <input type='checkbox' checked={draft.enabled} disabled={!snapshot || busy} onChange={event => change({ enabled: event.target.checked })} />
          Generar nuevas voces con Gemini
        </label>
        <p className={styles.hint}>La habilitación y los límites de generación se comparten con llamados.</p>
        <label className={styles.field}>
          Modelo
          <select value={draft.model} disabled={!snapshot || busy} onChange={event => change({ model: event.target.value as GreetingVoiceConfig['model'] })}>
            {greetingVoiceModels.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Voz de Gemini
          <VoiceSelect id={draft.voice} voices={catalogue.voices} required disabled={!snapshot || busy} onChange={voice => change({ voice })} />
        </label>
        {catalogue.loading && <p role='status'>Consultando voces…</p>}
        {catalogue.error && (
          <div role='alert'>
            <p>{catalogue.error}</p>
            <Button onClick={catalogue.retry}>Reintentar voces</Button>
          </div>
        )}
        <label className={styles.field}>
          Estilo y acento
          <textarea value={draft.style} maxLength={800} rows={4} required disabled={!snapshot || busy} onChange={event => change({ style: event.target.value })} />
        </label>
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={!snapshot || busy || changedElsewhere} aria-describedby={`${id}-help`}>Guardar ajustes</Button>
          <Button disabled={!snapshot?.configured || busy || dirty || processing} aria-describedby={`${id}-help ${id}-preview-help`} onClick={() => void execute('check')}>Comprobar conexión</Button>
        </div>
        <p id={`${id}-help`} className={styles.hint} role='status'>{help}</p>
        {notice && <p className={styles.notice} role='status'>{notice}</p>}
        {error && <p className={styles.error} role='alert'>{error}</p>}
        {(error || changedElsewhere) && <Button disabled={busy} onClick={() => void execute('reload')}>Recargar ajustes</Button>}
        <section className={styles.preview} aria-labelledby={`${id}-preview-title`} aria-busy={pendingAction === 'preview'}>
          <h3 id={`${id}-preview-title`}>Probar voz</h3>
          <p>{greetingVoiceSample}</p>
          <Button variant='primary' disabled={!snapshot?.configured || busy || dirty || processing || ['limited', 'error'].includes(snapshot.state)} aria-describedby={`${id}-preview-help`} onClick={() => void execute('preview')}>
            {pendingAction === 'preview' ? 'Generando…' : preview ? 'Generar otra prueba' : 'Generar audio de prueba'}
          </Button>
          <p className={styles.hint}>Se escucha solo en este navegador. Generar consume una solicitud.</p>
          <p id={`${id}-preview-help`} className={styles.hint} role='status'>{previewHelp}</p>
          {previewError && <p className={styles.error} role='alert'>{previewError}</p>}
          {preview && (
            <div className={styles.previewResult}>
              <p id={`${id}-playback-title`} className={styles.notice} role='status'>Reproducir prueba</p>
              <audio aria-labelledby={`${id}-playback-title`} controls src={preview} />
            </div>
          )}
        </section>
        <details>
          <summary>Límites de generación</summary>
          <div className={styles.limits}>
            <label className={styles.field}>
              Solicitudes por minuto
              <input type='number' min={1} max={1000} value={draft.requestsPerMinute} disabled={!snapshot || busy} onChange={event => change({ requestsPerMinute: Number(event.target.value) })} />
            </label>
            <label className={styles.field}>
              Solicitudes por día
              <input type='number' min={1} max={100000} value={draft.requestsPerDay} disabled={!snapshot || busy} onChange={event => change({ requestsPerDay: Number(event.target.value) })} />
            </label>
          </div>
        </details>
      </form>
    </section>
  )
}
