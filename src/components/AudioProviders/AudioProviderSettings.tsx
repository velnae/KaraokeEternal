import React, { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { providerUseLabels, type ManagedAudioProvider, type ProviderUse } from 'shared/audioProviders'
import type { NameVoiceStyleSettings } from 'shared/nameVoices'
import GreetingVoiceSettings from './GreetingVoiceSettings'
import BirthdayVoiceSettings from './BirthdayVoiceSettings'
import NameVoiceStyleEditor from '../Animation/NameVoiceStyleEditor'
import styles from './Providers.css'
import CallVoiceSettings from './CallVoiceSettings'

const api = new HttpApi('audio-providers/')
const names = new HttpApi('name-voices/')

function Connection ({ provider }: { provider: ManagedAudioProvider }) {
  const [use, setUse] = useState<ProviderUse>(provider.checks[0]?.use ?? 'greetings')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const selectedUse = provider.checks.some(check => check.use === use) ? use : provider.checks[0]?.use
  const check = async () => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await api.post<{ model: string }>(`${provider.id}/check`, { body: { use: selectedUse } })
      setMessage(`Modelo verificado: ${result.model}`)
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <section className={styles.connection} aria-label={provider.name}>
      <div>
        <h3>{provider.name}</h3>
        <span>{provider.configured ? 'Credenciales configuradas' : 'Sin configurar'}</span>
      </div>
      <div className={styles.actions}>
        {provider.checks.length > 1 && (
          <label>
            Comprobar para
            <select
              aria-label={`Uso para comprobar ${provider.name}`}
              value={selectedUse}
              disabled={busy}
              onChange={(event) => {
                setUse(event.target.value as ProviderUse)
                setMessage('')
                setError('')
              }}
            >
              {provider.checks.map(check => <option key={check.use} value={check.use}>{providerUseLabels[check.use]}</option>)}
            </select>
          </label>
        )}
        {provider.configured && <Button variant='default' disabled={busy} onClick={() => void check()}>{busy ? 'Comprobando…' : 'Comprobar conexión'}</Button>}
      </div>
      {!provider.configured && <p role='status'>{`Configure ${provider.id === 'gemini' ? 'KES_GEMINI_API_KEY' : 'KES_ELEVENLABS_API_KEY'} en el servidor.`}</p>}
      {message && <p role='status'>{message}</p>}
      {error && <p role='alert' className={styles.error}>{error}</p>}
      {provider.catalog && (
        <details>
          <summary>Configuración del catálogo en el servidor</summary>
          <dl>
            <dt>Modelo de voz</dt>
            <dd>{provider.catalog.models.voice}</dd>
            <dt>Voz predeterminada</dt>
            <dd>{provider.catalog.voiceId}</dd>
            <dt>Efectos y ambientes</dt>
            <dd>{provider.catalog.models.effect}</dd>
          </dl>
        </details>
      )}
    </section>
  )
}

function NameSettings () {
  const [settings, setSettings] = useState<NameVoiceStyleSettings | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const result = await names.get<NameVoiceStyleSettings>('style')
    setSettings(result)
    setError('')
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void names.get<NameVoiceStyleSettings>('style', { signal: controller.signal }).then((value): void => {
      if (active) setSettings(value)
      return undefined
    }).catch((err) => { if (active) setError(err.message) })
    return () => {
      active = false
      controller.abort()
    }
  }, [])
  return (
    <section className={styles.editor} aria-label='Configuración de nombres'>
      <header>
        <h2>Nombres</h2>
        <p>Todas las salas</p>
      </header>
      {error && (
        <div role='alert'>
          <p>{error}</p>
          <Button onClick={() => void refresh().catch(err => setError(err.message))}>Reintentar</Button>
        </div>
      )}
      {settings ? <NameVoiceStyleEditor settings={settings} onSaved={refresh} /> : !error && <p role='status'>Cargando configuración…</p>}
      <Link to='/admin/settings/audio-providers?use=calls'>Voz base de llamados</Link>
    </section>
  )
}

export default function AudioProviderSettings () {
  const [providers, setProviders] = useState<ManagedAudioProvider[]>([])
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const use = ['calls', 'names', 'birthdays'].includes(params.get('use') ?? '') ? params.get('use')! : 'greetings'
  const refresh = useCallback(() => {
    void api.get<{ providers: ManagedAudioProvider[] }>('').then((result): void => {
      setProviders(result.providers)
      setError('')
      return undefined
    }).catch(err => setError(err.message))
  }, [])
  useEffect(refresh, [refresh])
  return (
    <div className={styles.page}>
      <section aria-label='Conexiones'>
        <h2>Conexiones</h2>
        {providers.map(provider => <Connection key={provider.id} provider={provider} />)}
        {!providers.length && !error && <p role='status'>Cargando proveedores…</p>}
        {error && (
          <div role='alert'>
            <p>{error}</p>
            <Button onClick={refresh}>Reintentar</Button>
          </div>
        )}
      </section>
      <section aria-label='Configuración de voces'>
        <nav className={styles.tabs} aria-label='Configuración de voces'>
          <Link to='?use=greetings' aria-current={use === 'greetings' ? 'page' : undefined}>Saludos de participantes</Link>
          <Link to='?use=calls' aria-current={use === 'calls' ? 'page' : undefined}>Llamados y plantillas</Link>
          <Link to='?use=names' aria-current={use === 'names' ? 'page' : undefined}>Nombres</Link>
          <Link to='?use=birthdays' aria-current={use === 'birthdays' ? 'page' : undefined}>Cumpleaños</Link>
        </nav>
        {use === 'greetings' ? <GreetingVoiceSettings /> : use === 'calls' ? <CallVoiceSettings /> : use === 'names' ? <NameSettings /> : <BirthdayVoiceSettings onSaved={refresh} />}
      </section>
    </div>
  )
}
