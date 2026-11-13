import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { birthdayIntroText, initialBirthdayProfiles, validateBirthdaySettings, type BirthdayAsset, type BirthdayOverview, type BirthdaySettings as Settings, type BirthdayVoiceRule } from 'shared/birthdays'
import type { TransitionVideoOverview } from 'shared/transitionVideo'
import HttpApi from 'lib/HttpApi'
import { birthdayApi, birthdayUrl } from './api'
import useBirthdayOverview from './useBirthdayOverview'
import BirthdayProfileEditor from './BirthdayProfileEditor'
import { birthdayProfileAges, birthdayProfileTitle, birthdaySampleKey, birthdayVoiceName } from './settingsHelpers'
import useProviderVoices from 'components/AudioProviders/useProviderVoices'
import styles from './BirthdaySettings.css'

type ResourceKind = 'intro' | 'music' | 'video'
type Preview = { asset: BirthdayAsset, title: string, sample?: { config: Settings, voiceId: string, style?: string } }
const resourceLabels = { intro: 'Introducción', music: 'Música de cumpleaños', video: 'Fondo del cumpleaños' }

export default function BirthdaySettings () {
  const { overview, error: loadError, refresh } = useBirthdayOverview()
  const [config, setConfig] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<Settings | null>(null)
  const [videos, setVideos] = useState<{ id: string, title: string }[]>([])
  const [videoError, setVideoError] = useState('')
  const [video, setVideo] = useState('')
  const [localAssets, setLocalAssets] = useState<BirthdayAsset[]>([])
  const [resource, setResource] = useState<ResourceKind | null>(null)
  const [introTitle, setIntroTitle] = useState('Presentación y presente de la casa')
  const [introText, setIntroText] = useState(birthdayIntroText)
  const [editor, setEditor] = useState<{ index: number, rule: BirthdayVoiceRule } | null>(null)
  const [busy, setBusy] = useState('')
  const working = useRef(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [samples, setSamples] = useState<Record<string, BirthdayAsset>>({})
  const errorRef = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const addProfile = useRef<HTMLDivElement>(null)
  const media = useRef<HTMLMediaElement>(null)
  const selectedLanguage = config?.defaultVoiceId.toLowerCase().startsWith('es-419-') ? 'es-419' : 'es-PE'
  const catalogue = useProviderVoices({ providerId: config?.speechProvider ?? 'elevenlabs', use: 'birthdays', model: config?.speechModel ?? '', language: selectedLanguage, enabled: !!config })
  const voices = catalogue.voices
  useEffect(() => {
    if (overview) {
      setConfig(previous => previous ?? overview.settings)
      setSaved(previous => previous ?? overview.settings)
    }
  }, [overview])
  useEffect(() => {
    let live = true
    void new HttpApi('animation/background/').get<TransitionVideoOverview>('').then((result): void => {
      if (live) setVideos(result.videos.filter(item => item.state === 'ready').map(item => ({ id: item.id, title: item.title })))
      return undefined
    }).catch(() => { if (live) setVideoError('No se pudieron consultar los fondos. Abra la biblioteca de fondos para revisar su disponibilidad.') })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    const element = media.current
    return () => element?.pause()
  }, [preview?.asset.id])
  const action = async (label: string, operation: () => Promise<void>) => {
    if (working.current) return
    working.current = true
    setBusy(label)
    setError('')
    setNotice('')
    setConflict(false)
    try {
      await operation()
      refresh()
    } catch (failure) {
      setError((failure as Error).message)
      setConflict((failure as { status?: number }).status === 409)
      requestAnimationFrame(() => errorRef.current?.focus({ preventScroll: false }))
    } finally {
      working.current = false
      setBusy('')
    }
  }
  const attach = (asset: BirthdayAsset) => {
    setLocalAssets(previous => [...previous.filter(value => value.id !== asset.id), asset])
    setConfig(previous => previous && ({ ...previous, [`${asset.kind}Id`]: asset.id,
      ...(asset.kind === 'intro' ? { introIds: [...new Set([...(previous.introIds ?? (previous.introId ? [previous.introId] : [])), asset.id])] } : {}) }))
  }
  const openPreview = (value: Preview) => {
    setPreviewError('')
    setPreview(value)
  }
  const upload = (kind: 'intro' | 'music', file?: File) => {
    if (!file) return
    void action('Preparando audio…', async () => {
      const body = new FormData()
      body.append('kind', kind)
      body.append('file', file)
      attach(await birthdayApi.post<BirthdayAsset>('upload', { body }))
      setResource(null)
      setNotice('Audio preparado. Guarde los cambios para utilizarlo.')
    })
  }
  const audition = async (snapshot: Settings, voiceId: string, style?: string, regenerate = false, title = 'Prueba de voz') => {
    const key = birthdaySampleKey(snapshot, voiceId, style)
    const sample = { config: snapshot, voiceId, style }
    if (!regenerate && samples[key]) {
      openPreview({ asset: samples[key], title, sample })
      return
    }
    await action('Generando prueba de voz…', async () => {
      validateBirthdaySettings({ ...snapshot, defaultVoiceId: voiceId, speechStyle: style || snapshot.speechStyle })
      const asset = await birthdayApi.post<BirthdayAsset>('audition', { body: { config: snapshot, voiceId, style } })
      setSamples(previous => ({ ...previous, [key]: asset }))
      openPreview({ asset, title, sample })
    })
  }
  const closeEditor = () => {
    setEditor(null)
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
      else addProfile.current?.querySelector('button')?.focus({ preventScroll: true })
    })
  }
  if (!config || !saved || !overview) return (
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
  const dirty = JSON.stringify(config) !== JSON.stringify(saved)
  const assets = [...new Map([...overview.assets, ...localAssets].map(asset => [asset.id, asset])).values()]
  const activeIntroCount = (config.introIds ?? (config.introId ? [config.introId] : [])).length
  const voicePreview = (rule?: BirthdayVoiceRule) => {
    const key = birthdaySampleKey(config, rule?.voiceId ?? config.defaultVoiceId, rule?.style || config.speechStyle)
    return samples[key] ? 'Escuchar prueba' : 'Generar prueba'
  }
  const sameSavedVoice = birthdaySampleKey(config) === birthdaySampleKey(saved)
  const openEditor = (index: number, button: HTMLButtonElement) => {
    opener.current = button
    setEditor({ index, rule: config.rules[index] ?? { id: crypto.randomUUID(), title: '', minAge: 0, maxAge: 120, sex: 'any', voiceId: config.defaultVoiceId } })
  }
  const discard = () => {
    setConfig(saved)
    setError('')
    setNotice('')
    setConflict(false)
  }
  return (
    <section className={styles.settings} aria-label='Ajustes de cumpleaños'>
      {(error || loadError) && (
        <div ref={errorRef} tabIndex={-1} className={styles.error} role='alert'>
          <p>{error || loadError}</p>
          {conflict && (
            <Button onClick={() => void action('Recargando configuración…', async () => {
              const latest = await birthdayApi.get<BirthdayOverview>('')
              setConfig(latest.settings)
              setSaved(latest.settings)
            })}
            >
              Descartar y recargar configuración
            </Button>
          )}
        </div>
      )}
      {busy && <p role='status'>{busy}</p>}
      {notice && (!dirty || notice !== 'Ajustes guardados.') && <p role='status'>{notice}</p>}
      <fieldset disabled={!!busy} className={styles.section}>
        <legend>Saludo predeterminado</legend>
        <div className={styles.defaults}>
          <Link to='/admin/settings/audio-providers?use=birthdays'>Configurar proveedor y voz predeterminada</Link>
          <label>
            Duración objetivo (segundos)
            <input type='number' min={15} max={60} value={Number.isFinite(config.targetSeconds) ? config.targetSeconds : ''} onChange={event => setConfig({ ...config, targetSeconds: event.target.valueAsNumber })} />
          </label>
          <label>
            Referencia histórica cada
            <select value={config.historyEvery ?? 4} onChange={event => setConfig({ ...config, historyEvery: Number(event.target.value) })}>
              <option value={0}>Desactivada</option>
              {Array.from({ length: 20 }, (_, index) => index + 1).map(number => <option key={number} value={number}>{number === 1 ? 'Cada cumpleaños elegible' : `${number} cumpleaños elegibles`}</option>)}
            </select>
          </label>
        </div>
        {catalogue.loading && <p role='status' className={styles.muted}>Consultando voces…</p>}
        {!catalogue.loading && (catalogue.error || !voices.length) && (
          <div role='status' className={styles.catalogue}>
            <p>{catalogue.error || 'No hay voces disponibles para esta configuración.'}</p>
            <Button onClick={catalogue.retry}>Reintentar voces</Button>
            <Link to='/admin/settings/audio-providers?use=birthdays'>Revisar proveedor e idioma</Link>
          </div>
        )}
        <details className={styles.advanced}>
          <summary>Más opciones</summary>
          <div className={styles.advancedFields}>
            <label>
              Duración máxima (segundos)
              <input type='number' min={15} max={60} value={Number.isFinite(config.maxVoiceSeconds) ? config.maxVoiceSeconds : ''} onChange={event => setConfig({ ...config, maxVoiceSeconds: event.target.valueAsNumber })} />
            </label>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setConfig({ ...config, rules: initialBirthdayProfiles(config.speechProvider === 'gemini' ? '' : config.defaultVoiceId) })}>Restaurar perfiles iniciales</Button>
          </div>
        </details>
      </fieldset>
      <fieldset disabled={!!busy} className={styles.section}>
        <legend>Perfiles por edad</legend>
        <div>
          {config.rules.length === 0 && <p>Agregue un perfil o restaure los perfiles iniciales desde Más opciones.</p>}
          {config.rules.map((rule, index) => (
            <article key={rule.id ?? index} className={styles.profile} aria-label={rule.title || `Perfil ${index + 1}`}>
              <div>
                <h3>{birthdayProfileTitle(rule, index)}</h3>
                <p>
                  {birthdayProfileAges(rule)}
                  {rule.sex !== 'any' && ` · ${{ female: 'Femenino', male: 'Masculino', unspecified: 'Sin especificar' }[rule.sex]}`}
                </p>
              </div>
              <span className={styles.voiceName}>{birthdayVoiceName(rule.voiceId, voices)}</span>
              <div className={styles.actions}>
                <Button onClick={() => void audition(config, rule.voiceId, rule.style || config.speechStyle, false, rule.title || 'Prueba del perfil')}>{voicePreview(rule)}</Button>
                <Button aria-label={`Editar ${rule.title || `perfil ${index + 1}`}`} onClick={event => openEditor(index, event.currentTarget)}>Editar</Button>
              </div>
            </article>
          ))}
        </div>
        <div ref={addProfile}><Button onClick={event => openEditor(config.rules.length, event.currentTarget)}>Agregar perfil</Button></div>
      </fieldset>
      <fieldset disabled={!!busy} className={styles.section}>
        <legend>Escena del cumpleaños</legend>
        {(['intro', 'music', 'video'] as const).map((kind) => {
          const asset = assets.find(value => value.id === config[`${kind}Id`])
          return (
            <div key={kind} className={styles.resource}>
              <div>
                <h3>{resourceLabels[kind]}</h3>
                <p>{kind === 'intro' ? activeIntroCount === 1 ? '1 introducción activa' : `${activeIntroCount} introducciones activas` : asset ? `${asset.title} · ${Math.round(asset.durationMs / 1000)} s` : 'Sin seleccionar'}</p>
              </div>
              <div className={styles.actions}>
                {asset && <Button onClick={() => openPreview({ asset, title: resourceLabels[kind] })}>{kind === 'video' ? 'Ver fondo' : kind === 'intro' ? 'Escuchar introducción' : 'Escuchar música'}</Button>}
                <Button aria-label={`Cambiar ${resourceLabels[kind].toLowerCase()}`} onClick={() => setResource(kind)}>Cambiar</Button>
              </div>
            </div>
          )
        })}
      </fieldset>
      {dirty && (
        <div className={styles.saveBar}>
          <strong>Cambios sin guardar</strong>
          <div className={styles.actions}>
            <Button disabled={!!busy} onClick={discard}>Descartar</Button>
            <Button
              variant='primary'
              disabled={!!busy}
              onClick={() => void action('Guardando cambios…', async () => {
                const result = await birthdayApi.put<Settings>('settings', { body: validateBirthdaySettings(config) })
                setConfig(result)
                setSaved(result)
                setNotice('Ajustes guardados.')
              })}
            >
              Guardar cambios
            </Button>
          </div>
          {busy && <span role='status'>{busy}</span>}
        </div>
      )}
      {editor && (
        <BirthdayProfileEditor
          config={config}
          index={editor.index}
          initial={editor.rule}
          voices={voices}
          videos={assets.filter(asset => asset.kind === 'video')}
          onClose={closeEditor}
          onApply={(rule) => {
            const rules = [...config.rules]
            rules[editor.index] = rule
            setConfig({ ...config, rules })
            closeEditor()
          }}
          onRemove={editor.index < config.rules.length
            ? () => {
                setConfig({ ...config, rules: config.rules.filter((_, index) => index !== editor.index) })
                closeEditor()
              }
            : undefined}
        />
      )}
      {resource && (
        <Modal title={`Cambiar ${resourceLabels[resource].toLowerCase()}`} className={styles.editor} scrollable onClose={() => setResource(null)}>
          {error && <p role='alert'>{error}</p>}
          <fieldset disabled={!!busy} className={styles.resourceEditor}>
            {resource === 'intro'
              ? (
                  <div aria-label='Banco de introducciones'>
                    {assets.filter(asset => asset.kind === 'intro').map(asset => (
                      <div key={asset.id} className={styles.resource}>
                        <label>
                          <input
                            type='checkbox'
                            checked={(config.introIds ?? (config.introId ? [config.introId] : [])).includes(asset.id)}
                            onChange={(event) => {
                              const active = config.introIds ?? (config.introId ? [config.introId] : [])
                              const introIds = event.target.checked ? [...active, asset.id] : active.filter(id => id !== asset.id)
                              setConfig({ ...config, introIds, introId: introIds[0] ?? null })
                            }}
                          />
                          {asset.title}
                        </label>
                        <Button onClick={() => openPreview({ asset, title: asset.title })}>Escuchar</Button>
                      </div>
                    ))}
                    {!(config.introIds ?? (config.introId ? [config.introId] : [])).length && <p role='status'>Active una introducción para preparar cumpleaños.</p>}
                  </div>
                )
              : (
                  <label>
                    {resourceLabels[resource]}
                    <select value={config[`${resource}Id`] ?? ''} onChange={event => setConfig({ ...config, [`${resource}Id`]: event.target.value || null })}>
                      <option value=''>Sin seleccionar</option>
                      {assets.filter(asset => asset.kind === resource).map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
                    </select>
                  </label>
                )}
            {resource !== 'video'
              ? (
                  <>
                    <label>
                      {resource === 'intro' ? 'Subir introducción' : 'Subir música'}
                      <input type='file' accept='audio/mpeg,audio/wav,audio/ogg' onChange={event => upload(resource, event.target.files?.[0])} />
                    </label>
                    {resource === 'intro' && (
                      <>
                        <label>
                          Nombre de la variante
                          <input value={introTitle} maxLength={100} onChange={event => setIntroTitle(event.target.value)} />
                        </label>
                        <label>
                          Texto de la introducción
                          <textarea rows={5} value={introText} maxLength={1000} onChange={event => setIntroText(event.target.value)} />
                        </label>
                        {!sameSavedVoice && <p role='status'>Guarde los cambios de voz antes de generar la introducción.</p>}
                        <Button
                          disabled={!sameSavedVoice}
                          onClick={() => void action('Generando introducción…', async () => {
                            attach(await birthdayApi.post<BirthdayAsset>('intro', { body: { title: introTitle, text: introText } }))
                            setResource(null)
                            setNotice('Introducción preparada. Guarde los cambios para utilizarla.')
                          })}
                        >
                          Generar con la voz guardada
                        </Button>
                      </>
                    )}
                  </>
                )
              : (
                  <>
                    {videoError && <p role='alert'>{videoError}</p>}
                    <label>
                      Copiar de los fondos guardados
                      <select value={video} onChange={event => setVideo(event.target.value)}>
                        <option value=''>Seleccione un fondo</option>
                        {videos.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
                      </select>
                    </label>
                    <Button onClick={() => void action('Preparando video…', async () => {
                      if (!video) throw new Error('Seleccione un fondo guardado.')
                      attach(await birthdayApi.post<BirthdayAsset>('video', { body: { id: video } }))
                      setResource(null)
                      setNotice('Video preparado. Guarde los cambios para utilizarlo.')
                    })}
                    >
                      Usar este fondo
                    </Button>
                    <Link to='/admin/settings/animator?view=background'>Administrar fondos de video</Link>
                  </>
                )}
          </fieldset>
          {busy && <p role='status'>{busy}</p>}
          <Button onClick={() => setResource(null)}>Listo</Button>
        </Modal>
      )}
      {preview && (
        <Modal title={preview.title} className={styles.editor} onClose={() => setPreview(null)}>
          {error && <p role='alert'>{error}</p>}
          <div className={styles.preview}>
            <strong>Prueba en este dispositivo</strong>
            {preview.asset.kind === 'video' ? <video ref={media as React.RefObject<HTMLVideoElement>} src={birthdayUrl(preview.asset.url)} controls muted autoPlay loop playsInline onError={() => setPreviewError('No se pudo abrir el archivo guardado.')} /> : <audio ref={media as React.RefObject<HTMLAudioElement>} key={preview.asset.id} src={birthdayUrl(preview.asset.url)} controls autoPlay onError={() => setPreviewError('No se pudo abrir el archivo guardado.')} />}
            {previewError && (
              <div role='alert'>
                <p>{previewError}</p>
                <Button onClick={() => {
                  setPreviewError('')
                  media.current?.load()
                }}
                >
                  Reintentar
                </Button>
              </div>
            )}
            {preview.sample && (
              <Button
                disabled={!!busy}
                onClick={() => {
                  const sample = preview.sample!
                  void audition(sample.config, sample.voiceId, sample.style, true, preview.title)
                }}
              >
                Generar otra prueba
              </Button>
            )}
            {busy && <p role='status'>{busy}</p>}
            <Button onClick={() => setPreview(null)}>Cerrar prueba</Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
