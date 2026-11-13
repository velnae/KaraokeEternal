import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import type { CallVoiceConfig } from 'shared/callVoice'
import { greetingVoiceModels } from 'shared/greetingVoice'
import useProviderVoices from './useProviderVoices'
import VoiceSelect from './VoiceSelect'
import styles from './Providers.css'
import { Link } from 'react-router'

const api = new HttpApi('audio-providers/')
export default function CallVoiceSettings () {
  const [config, setConfig] = useState<CallVoiceConfig | null>(null)
  const [saved, setSaved] = useState<CallVoiceConfig | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const catalogue = useProviderVoices({ providerId: 'gemini', use: 'calls', model: config?.model ?? '', enabled: !!config })
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void api.get<CallVoiceConfig>('call-voice', { signal: controller.signal }).then((result): void => {
      if (active) {
        setConfig(result)
        setSaved(result)
        setError('')
      }
      return undefined
    }).catch((err) => { if (active) setError(err.message) })
    return () => {
      active = false
      controller.abort()
    }
  }, [reload])
  const save = async () => {
    if (!config || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api.put<CallVoiceConfig>('call-voice', { body: config })
      setConfig(result)
      setSaved(result)
      setNotice('Configuración guardada. Las grabaciones seleccionadas se conservan.')
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  if (!config) return error
    ? (
        <div role='alert'>
          <p>{error}</p>
          <Button onClick={() => setReload(value => value + 1)}>Reintentar</Button>
        </div>
      )
    : <p role='status'>Cargando configuración…</p>
  return (
    <section className={styles.editor} aria-label='Llamados y plantillas'>
      <header>
        <h2>Llamados y plantillas</h2>
        <p>Todas las salas · Valores para nuevas generaciones</p>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <label>
            Modelo de nuevas plantillas
            <select value={config.model} onChange={event => setConfig({ ...config, model: event.target.value as CallVoiceConfig['model'] })}>
              {greetingVoiceModels.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label>
            Voz de nuevas plantillas
            <VoiceSelect id={config.voice} voices={catalogue.voices} required onChange={voice => setConfig({ ...config, voice })} />
          </label>
          <label className={styles.full}>
            Estilo de nuevas plantillas
            <textarea rows={4} required maxLength={800} value={config.style} onChange={event => setConfig({ ...config, style: event.target.value })} />
          </label>
        </fieldset>
        {catalogue.loading && <p role='status'>Consultando voces…</p>}
        {catalogue.error && <p role='alert'>{catalogue.error}</p>}
        {error && <p role='alert'>{error}</p>}
        {notice && <p role='status'>{notice}</p>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={busy}>{busy ? 'Guardando…' : 'Guardar configuración'}</Button>
          <Button variant='default' disabled={busy} onClick={() => setConfig(saved)}>Descartar cambios</Button>
          {error && <Button onClick={() => setReload(value => value + 1)}>Recargar configuración</Button>}
          {catalogue.error && <Button onClick={catalogue.retry}>Reintentar voces</Button>}
        </div>
      </form>
      <Link to='/admin/settings/audio-providers?use=greetings'>Habilitación y límites compartidos de generación</Link>
      <Link to='/admin/settings/animator?view=calls'>Preparar y gestionar plantillas</Link>
    </section>
  )
}
