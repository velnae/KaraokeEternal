import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import { useAppSelector } from 'store/hooks'
import { validateBirthdaySettings, type BirthdayAsset, type BirthdayOverview, type BirthdaySettings } from 'shared/birthdays'
import { birthdayApi, birthdayUrl } from '../Birthdays/api'
import VoiceSelect from './VoiceSelect'
import useProviderVoices from './useProviderVoices'
import { changeBirthdayProvider } from './birthdayVoice'
import styles from './Providers.css'
import GeminiVoiceInput from './GeminiVoiceInput'

export default function BirthdayVoiceSettings ({ onSaved }: { onSaved: () => void }) {
  const roomId = useAppSelector(state => state.user.roomId)
  const roomName = useAppSelector(state => state.rooms.entities[state.user.roomId]?.name)
  const [config, setConfig] = useState<BirthdaySettings | null>(null)
  const [saved, setSaved] = useState<BirthdaySettings | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [preview, setPreview] = useState<BirthdayAsset | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!Number.isInteger(roomId)) return
    const controller = new AbortController()
    let active = true
    void birthdayApi.get<BirthdayOverview>('', { signal: controller.signal }).then((result): void => {
      if (active) {
        setConfig(result.settings)
        setSaved(result.settings)
        setError('')
        setConflict(false)
      }
      return undefined
    }).catch((err) => { if (active) setError(err.message) })
    return () => {
      active = false
      controller.abort()
    }
  }, [roomId, reload])
  const provider = config?.speechProvider ?? 'elevenlabs'
  const catalogue = useProviderVoices({ providerId: provider, use: 'birthdays', model: config?.speechModel ?? '', enabled: !!config && provider !== 'gemini' })
  const changedProvider = !!saved && (saved.speechProvider ?? 'elevenlabs') !== provider
  const dirty = !!config && JSON.stringify(config) !== JSON.stringify(saved)
  const change = (patch: Partial<BirthdaySettings>) => {
    setConfig(value => value && ({ ...value, ...patch }))
    setNotice('')
    setPreview(null)
  }
  const execute = async (operation: 'save' | 'preview') => {
    if (!config || working.current) return
    working.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setConflict(false)
    try {
      const validated = validateBirthdaySettings(config)
      if (changedProvider && provider !== 'gemini' && !catalogue.voices.some(voice => voice.voiceId === config.defaultVoiceId)) throw new Error('Seleccione una voz del nuevo proveedor.')
      if (operation === 'save') {
        const result = await birthdayApi.put<BirthdaySettings>('settings', { body: validated })
        setConfig(result)
        setSaved(result)
        setNotice('Configuración guardada.')
        onSaved()
      } else {
        setPreview(await birthdayApi.post<BirthdayAsset>('audition', { body: { config: validated, voiceId: validated.defaultVoiceId } }))
      }
    } catch (err) {
      setError((err as Error).message)
      setConflict((err as { status?: number }).status === 409)
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  if (!Number.isInteger(roomId)) return <p role='status'>Ingrese a una sala para configurar sus cumpleaños.</p>
  if (!config) return (
    <div role='status'>
      {error || 'Cargando configuración…'}
      {error && <Button onClick={() => setReload(value => value + 1)}>Reintentar</Button>}
    </div>
  )
  return (
    <section className={styles.editor} aria-label='Voz de cumpleaños'>
      <header>
        <h2>Cumpleaños</h2>
        <p>{`Sala: ${roomName ?? roomId}`}</p>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault()
        void execute('save')
      }}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <label>
            Proveedor de voz
            <select
              value={provider}
              onChange={(event) => {
                setConfig(changeBirthdayProvider(config, event.target.value as 'gemini' | 'elevenlabs'))
                setNotice('')
                setPreview(null)
              }}
            >
              <option value='gemini'>Gemini</option>
              <option value='elevenlabs'>ElevenLabs</option>
            </select>
          </label>
          <label>
            Modelo de voz
            <input type='text' value={config.speechModel ?? ''} required onChange={event => change({ speechModel: event.target.value })} />
          </label>
          <label>
            {provider === 'gemini' ? 'Nombre exacto de la voz' : 'Voz predeterminada'}
            {provider === 'gemini'
              ? <GeminiVoiceInput value={config.defaultVoiceId} model={config.speechModel ?? ''} onChange={defaultVoiceId => change({ defaultVoiceId })} />
              : <VoiceSelect id={config.defaultVoiceId} voices={catalogue.voices} required onChange={defaultVoiceId => change({ defaultVoiceId })} />}
          </label>
          <label className={styles.full}>
            Interpretación predeterminada
            <textarea rows={3} maxLength={400} required={provider !== 'gemini'} value={config.speechStyle ?? ''} onChange={event => change({ speechStyle: event.target.value })} />
          </label>
        </fieldset>
        {catalogue.loading && <p role='status'>Consultando voces…</p>}
        {catalogue.error && (
          <div role='alert'>
            <p>{catalogue.error}</p>
            <Button onClick={catalogue.retry}>Reintentar voces</Button>
          </div>
        )}
        <details>
          <summary>Más opciones</summary>
          <label>
            Modelo de texto Gemini
            <input type='text' value={config.textModel} required disabled={busy} onChange={event => change({ textModel: event.target.value })} />
          </label>
        </details>
        {error && <p role='alert' className={styles.error}>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={busy}>Guardar cambios</Button>
          {dirty && (
            <Button
              variant='default'
              disabled={busy}
              onClick={() => {
                setConfig(saved)
                setError('')
                setPreview(null)
              }}
            >
              Descartar cambios
            </Button>
          )}
          <Button variant='default' disabled={busy} onClick={() => void execute('preview')}>{busy ? 'Procesando…' : 'Generar prueba de voz'}</Button>
          {conflict && (
            <Button onClick={() => {
              setConfig(null)
              setReload(value => value + 1)
            }}
            >
              Recargar configuración
            </Button>
          )}
        </div>
      </form>
      <p>La prueba se escucha en este navegador y consume una generación.</p>
      {preview && <audio aria-label='Prueba de voz de cumpleaños' controls src={birthdayUrl(preview.url)} />}
      <Link to='/admin/settings/birthdays?view=settings'>Perfiles y recursos de cumpleaños</Link>
    </section>
  )
}
