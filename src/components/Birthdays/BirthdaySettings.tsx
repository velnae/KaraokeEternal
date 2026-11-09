import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import { approachLabels, birthdayApproaches, birthdayIntroText, initialBirthdayProfiles, type BirthdayAsset, type BirthdaySettings as Settings, type BirthdayVoiceRule } from 'shared/birthdays'
import type { TransitionVideoOverview } from 'shared/transitionVideo'
import HttpApi from 'lib/HttpApi'
import { birthdayApi, birthdayUrl } from './api'
import useBirthdayOverview from './useBirthdayOverview'
import styles from './Birthdays.css'

export default function BirthdaySettings () {
  const { overview, error: loadError, refresh } = useBirthdayOverview()
  const [config, setConfig] = useState<Settings | null>(null)
  const [voices, setVoices] = useState<{ voiceId: string, name: string }[]>([])
  const [videos, setVideos] = useState<{ id: string, title: string }[]>([])
  const [video, setVideo] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<BirthdayAsset | null>(null)
  const [language, setLanguage] = useState('es-PE')
  useEffect(() => {
    if (overview) setConfig(previous => previous ?? overview.settings)
  }, [overview])
  useEffect(() => {
    let live = true
    void new HttpApi('animation/background/').get<TransitionVideoOverview>('').then((result): void => {
      if (live) setVideos(result.videos.filter(item => item.state === 'ready').map(item => ({ id: item.id, title: item.title })))
      return undefined
    }).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const action = async (label: string, operation: () => Promise<void>) => {
    if (busy) return
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await operation()
      refresh()
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setBusy('') }
  }
  const attach = (resource: BirthdayAsset) => setConfig(previous => previous && ({ ...previous, [`${resource.kind}Id`]: resource.id }))
  const upload = (kind: 'intro' | 'music', file?: File) => {
    if (!file) return
    void action('Preparando audio…', async () => {
      const body = new FormData()
      body.append('kind', kind)
      body.append('file', file)
      attach(await birthdayApi.post<BirthdayAsset>('upload', { body }))
      setNotice('Audio preparado. Guarde los ajustes para utilizarlo.')
    })
  }
  if (!config || !overview) return (
    <div>
      <p role='status'>{loadError || 'Cargando ajustes…'}</p>
      {loadError && (
        <>
          <Button onClick={refresh}>Reintentar</Button>
          <Link to='/admin/rooms'>Salas y mesas</Link>
        </>
      )}
    </div>
  )
  const voiceOptions = (id: string) => (
    <>
      {!voices.some(voice => voice.voiceId === id) && <option value={id}>{id || 'Seleccione una voz'}</option>}
      {voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>)}
    </>
  )
  return (
    <section className={styles.settings} aria-label='Ajustes de cumpleaños'>
      {(error || loadError) && <p role='alert'>{error || loadError}</p>}
      {busy && <p role='status'>{busy}</p>}
      {notice && <p role='status'>{notice}</p>}
      {(!overview.configured.text || !overview.configured.voice) && <p role='alert'>Configure Gemini y la clave del proveedor de voz elegido en el servidor.</p>}
      <fieldset disabled={!!busy}>
        <legend>Saludo y voces</legend>
        <label>
          Modelo de texto Gemini
          <input type='text' value={config.textModel} onChange={e => setConfig({ ...config, textModel: e.target.value })} placeholder='Identificador del modelo de texto' />
        </label>
        <div className={styles.resource}>
          <label>
            Proveedor de voz
            <select
              value={config.speechProvider ?? 'elevenlabs'}
              onChange={(e) => {
                setVoices([])
                setConfig({ ...config, speechProvider: e.target.value as Settings['speechProvider'], speechModel: e.target.value === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4', defaultVoiceId: '', rules: [] })
              }}
            >
              <option value='gemini'>Gemini</option>
              <option value='elevenlabs'>ElevenLabs (existente)</option>
            </select>
          </label>
          <label>
            Modelo de voz
            <input type='text' value={config.speechModel ?? 'eleven_v4'} onChange={e => setConfig({ ...config, speechModel: e.target.value })} />
          </label>
          {config.speechProvider === 'gemini' && (
            <label>
              Idioma del catálogo
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value='es-PE'>Español de Perú</option>
                <option value='es-419'>Español latinoamericano</option>
                <option value='es'>Español</option>
              </select>
            </label>
          )}
        </div>
        <Button onClick={() => void action('Consultando voces…', async () => {
          const result = await birthdayApi.post<{ voiceId: string, name: string }[]>('voices', { body: { provider: config.speechProvider, model: config.speechModel, language } })
          setVoices(result)
          if (!result.length) setNotice('No hay voces para este idioma. Seleccione otro idioma del catálogo y vuelva a consultar.')
        })}
        >
          Consultar voces disponibles
        </Button>
        <div className={styles.resource}>
          <label>
            Duración objetivo del saludo (segundos)
            <input type='number' min={15} max={60} value={config.targetSeconds} onChange={e => setConfig({ ...config, targetSeconds: e.target.valueAsNumber })} />
          </label>
          <label>
            Duración máxima del saludo (segundos)
            <input type='number' min={15} max={60} value={config.maxVoiceSeconds} onChange={e => setConfig({ ...config, maxVoiceSeconds: e.target.valueAsNumber })} />
          </label>
        </div>
        <label>
          Voz predeterminada
          <select value={config.defaultVoiceId} onChange={e => setConfig({ ...config, defaultVoiceId: e.target.value })}>{voiceOptions(config.defaultVoiceId)}</select>
        </label>
        <label>
          Interpretación predeterminada
          <input type='text' maxLength={400} value={config.speechStyle ?? ''} onChange={e => setConfig({ ...config, speechStyle: e.target.value })} />
        </label>
        <Button onClick={() => void action('Preparando prueba de voz…', async () => setPreview(await birthdayApi.post<BirthdayAsset>('audition', { body: { config } })))}>Escuchar voz predeterminada</Button>
        <label>
          Referencia histórica cada cuántos cumpleaños elegibles (0: desactivada)
          <input type='number' min={0} max={20} value={config.historyEvery ?? 4} onChange={e => setConfig({ ...config, historyEvery: e.target.valueAsNumber })} />
        </label>
        <Button onClick={() => setConfig({ ...config, rules: initialBirthdayProfiles(config.speechProvider === 'gemini' ? '' : config.defaultVoiceId) })}>Usar perfiles iniciales por edad</Button>
        {config.rules.map((rule, index) => {
          const update = (patch: Partial<typeof rule>) => setConfig({ ...config, rules: config.rules.map((value, i) => i === index ? { ...value, ...patch } : value) })
          return (
            <fieldset key={rule.id ?? index}>
              <legend>{rule.title || `Perfil ${index + 1}`}</legend>
              <label>
                Nombre del perfil
                <input type='text' maxLength={80} value={rule.title ?? ''} onChange={e => update({ title: e.target.value })} />
              </label>
              <div className={styles.rule}>
                <label>
                  Sexo
                  <select value={rule.sex} onChange={e => update({ sex: e.target.value as BirthdayVoiceRule['sex'] })}>
                    <option value='any'>Cualquier sexo</option>
                    <option value='female'>Femenino</option>
                    <option value='male'>Masculino</option>
                    <option value='unspecified'>Sin especificar</option>
                  </select>
                </label>
                <label>
                  Desde
                  <input type='number' min={0} max={120} value={rule.minAge} onChange={e => update({ minAge: e.target.valueAsNumber })} />
                </label>
                <label>
                  Hasta
                  <input type='number' min={0} max={120} value={rule.maxAge} onChange={e => update({ maxAge: e.target.valueAsNumber })} />
                </label>
                <label>
                  Voz
                  <select value={rule.voiceId} onChange={e => update({ voiceId: e.target.value })}>{voiceOptions(rule.voiceId)}</select>
                </label>
                <Button aria-label={`Quitar regla ${index + 1}`} onClick={() => setConfig({ ...config, rules: config.rules.filter((_, i) => i !== index) })}>Quitar</Button>
              </div>
              <label>
                Indicaciones del saludo
                <input type='text' maxLength={500} value={rule.writing ?? ''} onChange={e => update({ writing: e.target.value })} />
              </label>
              <label>
                Interpretación de voz
                <input type='text' maxLength={400} value={rule.style ?? ''} onChange={e => update({ style: e.target.value })} />
              </label>
              <div className={styles.actions}>
                {birthdayApproaches.map(approach => (
                  <label key={approach}>
                    <input type='checkbox' checked={(rule.approaches ?? birthdayApproaches).includes(approach)} onChange={e => update({ approaches: e.target.checked ? [...(rule.approaches ?? birthdayApproaches), approach] : (rule.approaches ?? birthdayApproaches).filter(value => value !== approach) })} />
                    {approachLabels[approach]}
                  </label>
                ))}
              </div>
              <label>
                <input type='checkbox' checked={rule.history !== false} onChange={e => update({ history: e.target.checked })} />
                Permitir referencia histórica del nacimiento
              </label>
              <Button onClick={() => void action('Preparando prueba de voz…', async () => setPreview(await birthdayApi.post<BirthdayAsset>('audition', { body: { config, voiceId: rule.voiceId, style: rule.style || config.speechStyle } })))}>Escuchar este perfil</Button>
            </fieldset>
          )
        })}
        <Button onClick={() => setConfig({ ...config, rules: [...config.rules, { id: crypto.randomUUID(), sex: 'any', minAge: 0, maxAge: 120, voiceId: config.defaultVoiceId }] })}>Agregar perfil</Button>
      </fieldset>
      <fieldset disabled={!!busy}>
        <legend>Introducción y música</legend>
        <details>
          <summary>Texto de la introducción</summary>
          <p>{birthdayIntroText}</p>
        </details>
        <Button onClick={() => void action('Generando introducción…', async () => {
          attach(await birthdayApi.post<BirthdayAsset>('intro'))
          setNotice('Introducción preparada. Guarde los ajustes para utilizarla.')
        })}
        >
          Generar introducción con la voz guardada
        </Button>
        {(['intro', 'music'] as const).map(kind => (
          <div className={styles.resource} key={kind}>
            <label>
              {kind === 'intro' ? 'Introducción' : 'Música de cumpleaños'}
              <select value={config[`${kind}Id`] ?? ''} onChange={e => setConfig({ ...config, [`${kind}Id`]: e.target.value || null })}>
                <option value=''>Seleccione un audio</option>
                {overview.assets.filter(item => item.kind === kind).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label>
              {kind === 'intro' ? 'Subir introducción' : 'Subir música'}
              <input type='file' accept='audio/mpeg,audio/wav,audio/ogg' onChange={e => upload(kind, e.target.files?.[0])} />
            </label>
            {config[`${kind}Id`] && (
              <Button onClick={() => setPreview(overview.assets.find(item => item.id === config[`${kind}Id`]) ?? null)}>
                {`Escuchar ${kind === 'intro' ? 'introducción' : 'música'}`}
              </Button>
            )}
          </div>
        ))}
      </fieldset>
      <fieldset disabled={!!busy}>
        <legend>Video especial</legend>
        <label>
          Video del cumpleaños
          <select value={config.videoId ?? ''} onChange={e => setConfig({ ...config, videoId: e.target.value || null })}>
            <option value=''>Seleccione un video</option>
            {overview.assets.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label>
          Copiar de los fondos guardados
          <select value={video} onChange={e => setVideo(e.target.value)}>
            <option value=''>Seleccione un fondo</option>
            {videos.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <Button onClick={() => void action('Preparando video…', async () => {
          attach(await birthdayApi.post<BirthdayAsset>('video', { body: { id: video } }))
          setNotice('Video preparado. Guarde los ajustes para utilizarlo.')
        })}
        >
          Usar este fondo
        </Button>
        <Link to='/admin/settings/animator?view=background'>Administrar fondos de video</Link>
      </fieldset>
      <Button
        variant='primary'
        disabled={!!busy}
        onClick={() => void action('Guardando ajustes…', async () => {
          setConfig(await birthdayApi.put<Settings>('settings', { body: config }))
          setNotice('Ajustes guardados.')
        })}
      >
        Guardar ajustes
      </Button>
      {preview && (
        <div className={styles.preview}>
          <strong>Prueba en este dispositivo</strong>
          <audio key={preview.id} controls autoPlay src={birthdayUrl(preview.url)} />
          <Button onClick={() => setPreview(null)}>Cerrar prueba</Button>
        </div>
      )}
    </section>
  )
}
