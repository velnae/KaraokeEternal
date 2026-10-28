import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import { clipDurationLimit, familyLabels, VOICE_FAMILIES, type AudioKind, type RoomProfile } from 'shared/animation'
import type { AudioResource, ProviderCapabilities } from 'shared/audioCatalog'
import type { GenerationJob, ProductionInput } from 'shared/catalogProduction'
import styles from './AudioLibrary.css'
import AudioTagEditor from './AudioTagEditor'
import { DEFAULT_ANIMATOR_VOICE_ID, DEFAULT_ANIMATOR_VOICE_NAME } from 'shared/audioTags'

const api = new HttpApi('animation/')
export default function AudioResourceForm ({ kind, mode, providers, source, onClose, onSaved }: {
  kind: AudioKind
  mode: 'generate' | 'upload'
  providers: ProviderCapabilities[]
  source?: AudioResource
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const available = providers.filter(provider => provider.configured && provider.kinds.includes(kind))
  const [providerId, setProviderId] = useState(source?.metadata.providerId ?? available[0]?.id ?? '')
  const provider = available.find(item => item.id === providerId)
  const [connection, setConnection] = useState<{ key: string, voices: { voiceId: string, name: string }[], error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [voice, setVoice] = useState(source?.metadata.voiceId ?? '')
  const [title, setTitle] = useState(source?.title ?? '')
  const [text, setText] = useState(source?.metadata.text ?? '')
  const [family, setFamily] = useState(source?.metadata.family ?? (kind === 'voice' ? 'turn' : kind === 'effect' ? 'celebration' : 'manual'))
  const [category, setCategory] = useState(source?.metadata.category ?? '')
  const [language, setLanguage] = useState(source?.metadata.language ?? '')
  const [style, setStyle] = useState(source?.metadata.style ?? 'warm')
  const [duration, setDuration] = useState(kind === 'effect' ? 2 : 8)
  const [loop, setLoop] = useState(source?.metadata.loop ?? false)
  const [modes, setModes] = useState<RoomProfile[]>(source?.metadata.modes ?? ['dinner', 'mixed', 'party'])
  const [expires, setExpires] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const requestId = useRef(crypto.randomUUID())
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const connectionKey = `${providerId}:${kind}:${attempt}`
  useEffect(() => {
    if (mode !== 'generate' || !providerId) return
    let alive = true
    void api.post<{ voices: { voiceId: string, name: string }[] }>('production/check', { body: { providerId, kind } }).then((result): void => {
      if (alive) setConnection({ key: connectionKey, voices: result.voices })
      return undefined
    }).catch((error) => { if (alive) setConnection({ key: connectionKey, voices: [], error: error.message }) })
    return () => {
      alive = false
    }
  }, [mode, providerId, kind, connectionKey])
  const voices = connection?.key === connectionKey ? connection.voices : []
  const selectedVoice = voice || provider?.defaultVoiceId || voices[0]?.voiceId || ''
  const hasVoice = voices.some(item => item.voiceId === selectedVoice)
  const blocker = !title.trim()
    ? 'Indique un nombre.'
    : mode === 'upload' && !file
      ? 'Seleccione un archivo.'
      : mode === 'generate' && !provider
        ? 'Configure un proveedor en Ajustes.'
        : mode === 'generate' && connection?.key !== connectionKey
          ? 'Conectando con el proveedor…'
          : mode === 'generate' && connection?.error
            ? connection.error
            : mode === 'generate' && kind === 'voice' && !hasVoice
              ? 'Agregue la voz predeterminada a la cuenta de ElevenLabs o elija otra voz disponible.'
              : mode === 'generate' && !text.trim()
                ? 'Complete el texto o la descripción.'
                : !modes.length ? 'Seleccione un perfil.' : family === 'promotion' && !(Date.parse(expires) > Date.now()) ? 'Indique una vigencia futura.' : null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inFlight.current || blocker) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      if (mode === 'upload') {
        const body = new FormData()
        body.set('file', file!)
        body.set('title', title)
        body.set('kind', kind)
        body.set('requestId', requestId.current)
        body.set('metadata', JSON.stringify({ text, family, category, language, modes, ...(kind === 'ambience' ? { loop } : {}), validUntil: family === 'promotion' ? Date.parse(expires) : undefined }))
        const resource = await api.post<AudioResource>('resources/upload', { body })
        if (mounted.current) onSaved(resource.id)
      } else {
        const input: ProductionInput = { kind, title, text, providerId, family, category, voiceId: selectedVoice,
          language: kind === 'voice' ? providerId === 'elevenlabs' ? 'es' : language || provider?.languages[0] : undefined,
          style: providerId === 'elevenlabs' ? undefined : (provider?.styles.includes(style) ? style : provider?.styles[0]) as ProductionInput['style'],
          modes, durationSeconds: kind === 'voice' ? undefined : duration, loop: kind === 'ambience' && provider?.loop ? loop : undefined,
          validUntil: family === 'promotion' ? Date.parse(expires) : undefined,
          parentId: source?.id, versionRequestId: source ? requestId.current : undefined, revision: source ? Number(source.metadata.generationInput?.revision ?? 0) + 1 : 0 }
        const jobs = await api.post<GenerationJob[]>('production/jobs', { body: { inputs: [input] } })
        if (mounted.current) onSaved(`generated-${jobs[0].jobId}`)
      }
    } catch (error) { setError((error as Error).message) } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <Modal className={styles.dialog} title={mode === 'upload' ? 'Subir audio' : source ? 'Crear otra versión' : 'Generar audio'} onClose={onClose}>
      <form className={styles.form} onSubmit={event => void submit(event)}>
        <label>
          Nombre
          <input autoFocus value={title} maxLength={80} onChange={event => setTitle(event.target.value)} />
        </label>
        {mode === 'upload' && (
          <label>
            Archivo de audio
            <input type='file' aria-label='Archivo de audio' accept='.mp3,.wav,.ogg' onChange={event => setFile(event.target.files?.[0] ?? null)} />
            <small>{`MP3, WAV u OGG · Hasta ${clipDurationLimit(kind) / 1000} s y 20 MB`}</small>
          </label>
        )}
        {mode === 'generate' && available.length > 1 && (
          <label>
            Proveedor
            <select value={providerId} onChange={event => setProviderId(event.target.value)}>{available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
        )}
        {kind === 'voice' && mode === 'generate' && provider?.audioTags
          ? <AudioTagEditor value={text} onChange={setText} />
          : (
              <label>
                {kind === 'voice' ? mode === 'upload' ? 'Texto hablado (opcional)' : 'Texto del audio' : 'Descripción del sonido'}
                <textarea aria-label={kind === 'voice' ? mode === 'upload' ? 'Texto hablado (opcional)' : 'Texto del audio' : 'Descripción del sonido'} rows={3} value={text} maxLength={mode === 'generate' ? kind === 'voice' ? 220 : 450 : 2000} onChange={event => setText(event.target.value)} />
              </label>
            )}
        {kind === 'voice'
          ? (
              <>
                <label>
                  Uso del audio
                  <select aria-label='Uso del audio' value={family} onChange={event => setFamily(event.target.value as typeof family)}>
                    <option value='manual'>Anuncio puntual</option>
                    {VOICE_FAMILIES.map(value => <option key={value} value={value}>{familyLabels[value]}</option>)}
                  </select>
                </label>
                {mode === 'generate' && (
                  <label>
                    Voz
                    <select aria-label='Voz' value={selectedVoice} onChange={event => setVoice(event.target.value)}>
                      {!hasVoice && <option value={selectedVoice}>{selectedVoice === DEFAULT_ANIMATOR_VOICE_ID ? `${DEFAULT_ANIMATOR_VOICE_NAME} (no disponible en la cuenta)` : 'Seleccione una voz disponible'}</option>}
                      {voices.map(item => <option key={item.voiceId} value={item.voiceId}>{item.name}</option>)}
                    </select>
                  </label>
                )}
              </>
            )
          : (
              <label>
                Categoría
                <input value={category} placeholder={kind === 'effect' ? 'Aplausos, celebración…' : 'Restaurante, naturaleza…'} maxLength={120} onChange={event => setCategory(event.target.value)} />
              </label>
            )}
        {kind !== 'voice' && mode === 'generate' && (
          <label>
            Duración (segundos)
            <input type='number' min='0.5' max={clipDurationLimit(kind) / 1000} step='0.5' value={duration} onChange={event => setDuration(Number(event.target.value))} />
          </label>
        )}
        {family === 'promotion' && (
          <label>
            Vigente hasta
            <input type='datetime-local' value={expires} onChange={event => setExpires(event.target.value)} />
          </label>
        )}
        {kind === 'ambience' && (mode === 'upload' || provider?.loop) && (
          <label className={styles.check}>
            <input type='checkbox' checked={loop} onChange={event => setLoop(event.target.checked)} />
            Apto para repetirse en bucle
          </label>
        )}
        <details>
          <summary>Más opciones</summary>
          <div className={styles.fields}>
            {kind === 'voice' && mode === 'generate' && providerId !== 'elevenlabs' && (
              <label>
                Interpretación
                <select value={style} onChange={event => setStyle(event.target.value)}>{provider?.styles.map(value => <option key={value} value={value}>{{ warm: 'Cálida', cheerful: 'Alegre', celebration: 'Celebración' }[value] || value}</option>)}</select>
              </label>
            )}
            {kind === 'voice' && (mode === 'upload'
              ? (
                  <label>
                    Idioma
                    <input value={language} maxLength={120} onChange={event => setLanguage(event.target.value)} placeholder='Sin especificar' />
                  </label>
                )
              : providerId !== 'elevenlabs' && (
                <label>
                  Idioma
                  <select value={language || provider?.languages[0] || ''} onChange={event => setLanguage(event.target.value)}>{provider?.languages.map(value => <option key={value} value={value}>{value === 'es' ? 'Español' : value}</option>)}</select>
                </label>
              ))}
          </div>
          <fieldset>
            <legend>Perfiles de sala</legend>
            {(['dinner', 'mixed', 'party'] as const).map(value => (
              <label key={value} className={styles.check}>
                <input type='checkbox' checked={modes.includes(value)} onChange={event => setModes(previous => event.target.checked ? [...previous, value] : previous.filter(mode => mode !== value))} />
                {{ dinner: 'Cena', mixed: 'Mixto', party: 'Fiesta' }[value]}
              </label>
            ))}
          </fieldset>
        </details>
        {error && <p role='alert' className={styles.notice}>{error}</p>}
        {connection?.error && mode === 'generate' && <Button className={styles.secondary} onClick={() => setAttempt(value => value + 1)}>Reintentar conexión</Button>}
        {(busy || blocker) && <p id='resource-form-help' className={styles.help}>{busy ? 'Preparando el audio… Puede cerrar esta ventana; la solicitud continuará en el servidor.' : blocker}</p>}
        <div className={styles.actions}>
          <Button className={styles.secondary} onClick={onClose}>Cerrar</Button>
          <Button type='submit' variant='primary' disabled={busy || !!blocker} aria-describedby='resource-form-help'>{mode === 'upload' ? 'Subir audio' : 'Generar audio'}</Button>
        </div>
      </form>
    </Modal>
  )
}
