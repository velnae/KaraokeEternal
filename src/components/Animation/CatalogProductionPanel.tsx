import React, { useCallback, useEffect, useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import { familyLabels, VOICE_FAMILIES, type AudioKind, type VoiceFamily, type RoomProfile } from 'shared/animation'
import { pilotTexts, voicePrompt, type GenerationJob, type ProductionInput, type ProductionStatus, type VoiceStyle } from 'shared/catalogProduction'
import styles from './PhaseTwo.css'
import { Link } from 'react-router'

const api = new HttpApi('animation/')
const jobLabels: Record<GenerationJob['status'], string> = {
  queued: 'En cola', generating: 'Generando y preparando', ready_for_review: 'Pendiente de escucha',
  publishing: 'Publicando', published: 'Publicado', rejected: 'Descartado', failed: 'Fallido', uncertain: 'Resultado incierto', cancelled: 'Cancelado',
}

function MonitorAudio ({ jobId }: { jobId: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = ref.current
    return () => {
      audio?.pause()
    }
  }, [])
  return <audio ref={ref} controls preload='none' aria-label='Escuchar en monitoreo' src={`${document.baseURI}api/animation/production/${jobId}/audio`} />
}

export default function CatalogProductionPanel ({ view, onConnectionChange }: { view: 'audio' | 'connection' | 'hidden', onConnectionChange: (verified: boolean) => void }) {
  const roomId = useAppSelector(state => state.user.roomId)
  const userId = useAppSelector(state => state.user.userId)
  const trackingKey = `animation-production:${userId}:${roomId}`
  const [settings, setSettings] = useState<ProductionStatus | null>(null)
  const [jobs, setJobs] = useState<GenerationJob[]>([])
  const [voices, setVoices] = useState<{ voiceId: string, name: string }[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [kind, setKind] = useState<AudioKind>('voice')
  const [family, setFamily] = useState<VoiceFamily | 'manual'>('turn')
  const [style, setStyle] = useState<VoiceStyle>('warm')
  const [title, setTitle] = useState('Presentación')
  const [text, setText] = useState(pilotTexts.turn[0])
  const [duration, setDuration] = useState(2)
  const [validUntil, setValidUntil] = useState('')
  const [modes, setModes] = useState<RoomProfile[]>(['dinner', 'mixed', 'party'])
  const [monitoring, setMonitoring] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [lastGeneration, setLastGeneration] = useState<GenerationJob[]>([])
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const trackedIds = useRef<string[]>([])
  const loadSequence = useRef(0)
  const generationResult = useRef<HTMLDivElement>(null)
  const errorNotice = useRef<HTMLParagraphElement>(null)
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    const query = trackedIds.current.length ? `?include=${encodeURIComponent(trackedIds.current.join(','))}` : ''
    const result = await api.get<{ settings: ProductionStatus, jobs: GenerationJob[] }>(`production${query}`)
    if (!mounted.current || sequence !== loadSequence.current) return
    setSettings(result.settings)
    setJobs(result.jobs)
    if (result.settings.voices) {
      setVoices(result.settings.voices)
      setVoiceId(previous => result.settings.voices!.some(voice => voice.voiceId === previous)
        ? previous
        : result.settings.voiceId || result.settings.voices![0]?.voiceId || '')
    } else setVoiceId(previous => previous || result.settings.voiceId)
    setLastGeneration(result.jobs.filter(job => trackedIds.current.includes(job.jobId)))
  }, [])
  useEffect(() => {
    mounted.current = true
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(trackingKey) || '[]')
      trackedIds.current = Array.isArray(saved) ? saved.filter(id => typeof id === 'string').slice(0, 9) : []
    } catch { trackedIds.current = [] }
    setLastGeneration([])
    setJobs([])
    void load().catch(error => setError(error.message))
    return () => {
      mounted.current = false
    }
  }, [load, trackingKey])
  const pending = jobs.some(job => ['queued', 'generating', 'publishing'].includes(job.status))
  useEffect(() => {
    onConnectionChange(!!settings?.connectionVerified)
  }, [settings?.connectionVerified, onConnectionChange])
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => {
      void load().catch(error => setError(error.message))
    }, 1500)
    return () => clearInterval(timer)
  }, [pending, load])
  useEffect(() => {
    if (error) {
      errorNotice.current?.focus()
      errorNotice.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [error])
  const generationIds = lastGeneration.map(job => job.jobId).join(',')
  useEffect(() => {
    if (generationIds) generationResult.current?.scrollIntoView({ block: 'nearest' })
  }, [generationIds])
  const action = async (operation: () => Promise<unknown>) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await operation()
      await load()
    } catch (error) {
      setError((error as Error).message)
      await load().catch(() => {})
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const baseInput = (): ProductionInput => ({ title, text, kind, family, style, voiceId, modes, durationSeconds: kind === 'voice' ? undefined : duration,
    validUntil: family === 'promotion' && validUntil ? Date.parse(validUntil) : undefined })
  const generate = (inputs: ProductionInput[]) => action(async () => {
    trackedIds.current = []
    setLastGeneration([])
    const accepted = await api.post<GenerationJob[]>('production/jobs', { body: { inputs } })
    if (!mounted.current) return
    trackedIds.current = accepted.map(job => job.jobId)
    try {
      sessionStorage.setItem(trackingKey, JSON.stringify(trackedIds.current))
    } catch { /* Tracking remains available in memory when browser storage is disabled. */ }
    setLastGeneration(accepted)
    setJobs(previous => [...accepted, ...previous.filter(job => !trackedIds.current.includes(job.jobId))])
    setMessage('Solicitud recibida. Los recursos idénticos se reutilizan; revise su estado a continuación.')
  })
  const check = () => action(async () => {
    const result = await api.post<{ voices: { voiceId: string, name: string }[] }>('production/check')
    setVoices(result.voices)
    setVoiceId(previous => result.voices.some(voice => voice.voiceId === previous) ? previous : result.voices[0]?.voiceId ?? '')
    setMessage('Conexión verificada. Seleccione una voz y prepare el catálogo.')
  })
  const serviceBlocker = !settings
    ? 'Cargando conexión y disponibilidad del servicio…'
    : !settings.configured
        ? 'Configure KES_ELEVENLABS_API_KEY en el servidor para producir audios.'
        : !settings.processorAvailable
            ? settings.unavailableReason || 'Instale FFmpeg en el servidor para validar y normalizar los archivos.'
            : !settings.connectionVerified ? 'Verifique la conexión con ElevenLabs antes de generar.' : null
  const blocker = serviceBlocker ?? (!modes.length
    ? 'Seleccione al menos un perfil de sala.'
    : family === 'promotion' && !(Date.parse(validUntil) > Date.now())
      ? 'Defina una vigencia futura para la promoción.'
      : kind === 'voice' && !voiceId ? 'No hay una voz disponible seleccionada. Verifique la conexión y elija una voz de la cuenta.' : !text.trim() || !title.trim() ? 'Complete el título y el texto.' : null)
  const templates = family === 'manual' ? [] : pilotTexts[family]
  const estimate = (texts: string[]) => {
    const units = kind === 'voice' ? texts.reduce((total, value) => total + voicePrompt(value, style).length, 0) : duration * texts.length
    const price = kind === 'voice' ? settings?.pricePerThousandCharacters : settings?.pricePerEffectSecond
    const cost = price == null ? 'tarifa no configurada' : `${(units * price / (kind === 'voice' ? 1000 : 1)).toFixed(4)} USD estimados`
    return `${units} ${kind === 'voice' ? 'caracteres' : 'segundos'}; ${cost}`
  }
  return (
    <section hidden={view === 'hidden'} className={styles.production} aria-label={view === 'connection' ? 'Conexión y consumo' : 'Producción de catálogo'}>
      <div hidden={view !== 'connection'}>
        <h2>Conexión y consumo</h2>
        <p>Produzca voces con Eleven v4 y efectos o ambientes con Sound Effects. Solo los archivos revisados se publican.</p>
        <div className={styles.actions}>
          <Button disabled={busy || !settings?.configured} onClick={() => void check()}>Verificar conexión ElevenLabs</Button>
          <Button disabled={busy} onClick={() => void action(load)}>Actualizar producción</Button>
        </div>
        {!settings && <p role='status'>Cargando conexión y consumo…</p>}
        {settings && !settings.configured && <p className={styles.notice}>Configure KES_ELEVENLABS_API_KEY en el servidor y actualice la producción para verificar la conexión.</p>}
        {settings && (
          <p className={styles.budget}>
            Este mes, incluida la cola:
            {' '}
            {settings.usedCharacters}
            /
            {settings.characterLimit}
            {' '}
            caracteres de voz;
            {' '}
            {settings.usedEffectSeconds}
            /
            {settings.effectSecondsLimit}
            {' '}
            segundos de efectos. Límites compartidos por la instalación.
          </p>
        )}
      </div>
      {error && <p ref={errorNotice} tabIndex={-1} role='alert' className={styles.notice}>{error}</p>}
      {message && <p role='status'>{message}</p>}
      <div hidden={view !== 'audio'}>
        <h2>Audios de la sala</h2>
        <div className={styles.actions}><Button disabled={busy} onClick={() => void action(load)}>Actualizar producción</Button></div>
        <p>Genere un recurso, escúchelo y apruébelo antes de usarlo en público. Los trabajos continúan aunque cambie de sección.</p>
        {blocker && (
          <p className={styles.notice}>
            {blocker}
            {' '}
            {serviceBlocker && <Link to='?view=connection'>Ir a conexión y consumo</Link>}
          </p>
        )}
        <div className={styles.settingsRow}>
          <label>
            Tipo de recurso
            <select
              aria-label='Tipo de recurso'
              value={kind}
              onChange={(event) => {
                const next = event.target.value as AudioKind
                setKind(next)
                setFamily(next === 'voice' ? 'turn' : next === 'effect' ? 'celebration' : 'manual')
                setDuration(next === 'effect' ? 2 : 8)
              }}
            >
              <option value='voice'>Voz del animador</option>
              <option value='effect'>Efecto de apoyo</option>
              <option value='ambience'>Ambiente de pausa</option>
            </select>
          </label>
          <label>
            Familia
            <select aria-label='Familia del clip' value={family} onChange={event => setFamily(event.target.value as VoiceFamily | 'manual')}>
              <option value='manual'>Solo manual / ambiente</option>
              {VOICE_FAMILIES.map(value => <option key={value} value={value}>{familyLabels[value]}</option>)}
            </select>
          </label>
          {kind === 'voice' && (
            <label>
              Interpretación
              <select aria-label='Interpretación' value={style} onChange={event => setStyle(event.target.value as VoiceStyle)}>
                <option value='warm'>Cálida</option>
                <option value='cheerful'>Alegre</option>
                <option value='celebration'>Celebración suave</option>
              </select>
            </label>
          )}
        </div>
        <fieldset>
          <legend>Usar en perfiles de sala</legend>
          <div className={styles.events}>
            {(['dinner', 'mixed', 'party'] as const).map(mode => (
              <label key={mode}>
                <input
                  type='checkbox'
                  checked={modes.includes(mode)}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setModes(previous => checked ? [...previous, mode] : previous.filter(value => value !== mode))
                  }}
                />
                {{ dinner: 'Cena', mixed: 'Mixto', party: 'Fiesta' }[mode]}
              </label>
            ))}
          </div>
        </fieldset>
        {kind === 'voice'
          ? (
              <label className={styles.field}>
                Voz del local
                <select aria-label='Voz del local' value={voiceId} onChange={event => setVoiceId(event.target.value)}>
                  {!voices.length && <option value={voiceId}>{voiceId || (settings?.connectionVerified ? 'No hay voces disponibles en la cuenta' : 'Verifique la conexión para listar voces')}</option>}
                  {voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>)}
                </select>
              </label>
            )
          : (
              <label className={styles.field}>
                Duración solicitada (segundos)
                <input aria-label='Duración solicitada' type='number' min='0.5' max={kind === 'effect' ? 3 : 30} step='0.5' value={duration} onChange={event => setDuration(Number(event.target.value))} />
              </label>
            )}
        {family === 'promotion' && (
          <label className={styles.field}>
            Vigente hasta (hora de este dispositivo)
            <input type='datetime-local' value={validUntil} onChange={event => setValidUntil(event.target.value)} />
          </label>
        )}
        <label className={styles.field}>
          Título del recurso
          <input type='text' aria-label='Título del recurso' value={title} maxLength={80} onChange={event => setTitle(event.target.value)} />
        </label>
        <label className={styles.field}>
          {kind === 'voice' ? 'Texto del clip' : 'Descripción del sonido'}
          <textarea aria-label='Texto o descripción' value={text} maxLength={kind === 'voice' ? 220 : 450} rows={3} onChange={event => setText(event.target.value)} />
        </label>
        <p className={styles.hint}>
          {text.length}
          {' '}
          caracteres.
          {' '}
          {kind === 'voice' ? 'La voz final debe durar como máximo 10 segundos.' : 'El ambiente se reproduce con permisos cortos e interrumpibles.'}
          {' '}
          La generación puede consumir saldo; la reproducción local no genera otra llamada.
        </p>
        <p className={styles.budget}>
          Este recurso:
          {' '}
          {estimate([text])}
        </p>
        {kind === 'voice' && templates.length > 0 && (
          <p className={styles.budget}>
            Lote de tres variantes:
            {' '}
            {estimate(templates)}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant='primary' disabled={busy || !!blocker} aria-describedby='generation-help' onClick={() => void generate([baseInput()])}>{busy ? 'Procesando solicitud…' : 'Generar recurso'}</Button>
          {kind === 'voice' && templates.length > 0 && <Button disabled={busy || !!blocker} aria-describedby='generation-help' onClick={() => void generate(templates.map((value, index) => ({ ...baseInput(), title: `${familyLabels[family as VoiceFamily]} ${index + 1}`, text: value })))}>Generar 3 variantes de esta familia</Button>}
        </div>
        <p id='generation-help' className={styles.hint}>{busy ? 'Espere la confirmación del servidor.' : blocker ?? 'El audio aparecerá primero como pendiente de escucha. No se publicará automáticamente.'}</p>
        {lastGeneration.length > 0 && (
          <div ref={generationResult} className={styles.generationResult} role='status' aria-live='polite' aria-label='Resultado de la generación'>
            <strong>Última solicitud</strong>
            {lastGeneration.map(job => (
              <div key={job.jobId}>
                <p>
                  {job.config.title}
                  :
                  {' '}
                  {jobLabels[job.status]}
                </p>
                {job.error && <p className={styles.notice}>{job.error}</p>}
                {job.status === 'ready_for_review' && <p className={styles.hint}>El audio está listo. Escúchelo y apruébelo en la lista de recursos.</p>}
                {['failed', 'uncertain', 'cancelled', 'rejected'].includes(job.status) && <p className={styles.hint}>Volver a enviar el mismo texto reutiliza este registro. Corrija el contenido o use «Regenerar con nuevo consumo» si desea otro intento.</p>}
              </div>
            ))}
          </div>
        )}
        {kind === 'voice' && templates.length > 0 && (
          <details>
            <summary>Textos incluidos en el lote</summary>
            <ul>{templates.map(value => <li key={value}>{value}</li>)}</ul>
            <p>
              {templates.reduce((total, value) => total + value.length, 0)}
              {' '}
              caracteres de texto, más instrucciones del perfil.
            </p>
          </details>
        )}
        <label className={styles.check}>
          <input type='checkbox' checked={monitoring} onChange={event => setMonitoring(event.target.checked)} />
          Uso una salida de monitoreo separada de los parlantes del público
        </label>
        <p className={styles.hint}>Escuche y revise cada archivo antes de aprobarlo. La previsualización suena únicamente en este dispositivo y no cuenta como emisión pública.</p>
        <ul className={styles.jobs}>
          {jobs.map(job => (
            <li key={job.jobId} data-testid='generation-job' data-job-id={job.jobId} data-state={job.status}>
              <div className={styles.jobHeading}>
                <strong>{job.config.title}</strong>
                <span>{jobLabels[job.status]}</span>
              </div>
              <p>{job.config.text}</p>
              <small>
                {job.config.model}
                {' '}
                ·
                {' '}
                {job.units}
                {' '}
                {job.unitType === 'characters' ? 'caracteres' : 'segundos'}
                {job.estimatedCost !== null ? ` · estimado ${job.estimatedCost.toFixed(4)}` : ' · tarifa no configurada'}
              </small>
              {job.error && <p className={styles.notice}>{job.error}</p>}
              {view === 'audio' && monitoring && ['ready_for_review', 'published'].includes(job.status) && <MonitorAudio jobId={job.jobId} />}
              <div className={styles.actions}>
                {job.status === 'ready_for_review' && (
                  <>
                    <Button disabled={busy || !monitoring} onClick={() => void action(() => api.post(`production/${job.jobId}/review`, { body: { approve: true, monitoringConfirmed: monitoring } }))}>Aprobar y publicar</Button>
                    <Button disabled={busy} onClick={() => void action(() => api.post(`production/${job.jobId}/review`, { body: { approve: false } }))}>Descartar</Button>
                  </>
                )}
                {job.status === 'published' && <Button disabled={busy} onClick={() => void action(() => api.request('PATCH', `catalog/generated-${job.jobId}`, { body: { active: !job.active } }))}>{job.active ? 'Desactivar recurso' : 'Activar recurso'}</Button>}
                {job.status === 'queued' && <Button disabled={busy} onClick={() => void action(() => api.post(`production/${job.jobId}/cancel`))}>Cancelar generación pendiente</Button>}
                {!['queued', 'generating', 'publishing'].includes(job.status) && <Button disabled={busy || !!serviceBlocker} onClick={() => void generate([{ ...job.config, revision: (job.config.revision ?? 0) + 1 }])}>Regenerar con nuevo consumo</Button>}
              </div>
            </li>
          ))}
        </ul>
        {!jobs.length && <p>Todavía no hay recursos generados. Complete el formulario para preparar el primero.</p>}
      </div>
    </section>
  )
}
