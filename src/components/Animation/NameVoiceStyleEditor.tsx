import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { nameVoiceStyleLimit, type NameVoiceModel, type NameVoiceStyleSettings } from 'shared/nameVoices'
import styles from './NameVoicePanel.css'
import formStyles from './KaraokeCallPilot.css'

const api = new HttpApi('name-voices/')
const errorMessage = (error: unknown) => {
  const message = (error as Error).message
  try {
    const parsed = JSON.parse(message)
    return typeof parsed.error === 'string' ? parsed.error : message
  } catch { return message }
}

export default function NameVoiceStyleEditor ({ settings, onSaved }: { settings: NameVoiceStyleSettings, onSaved: () => Promise<void> }) {
  const styleId = useId()
  const [base, setBase] = useState(settings)
  const [draft, setDraft] = useState(settings.style)
  const [model, setModel] = useState(settings.model)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const alive = useRef(false)
  const working = useRef(false)
  const dirty = draft !== base.style || model !== base.model
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    // Polling may refresh saved values, never a draft or a newer PUT response.
    if (!dirty && !saving && settings.revision >= base.revision
      && (settings.revision !== base.revision || settings.style !== base.style || settings.model !== base.model || settings.defaultStyle !== base.defaultStyle)) {
      setBase(settings)
      setDraft(settings.style)
      setModel(settings.model)
    }
  }, [settings, dirty, saving, base.revision, base.style, base.model, base.defaultStyle])

  const save = async () => {
    if (working.current) return
    setError('')
    setNotice('')
    setConflict(false)
    if (!draft.trim()) {
      setError('Ingrese el estilo de pronunciación.')
      return
    }
    if (!dirty && base.revision > 0) {
      setNotice('La configuración ya está guardada.')
      return
    }
    working.current = true
    setSaving(true)
    try {
      const result = await api.put<NameVoiceStyleSettings>('style', { body: { style: draft, model, revision: base.revision } })
      if (alive.current) {
        setBase(result)
        setDraft(result.style)
        setModel(result.model)
        setNotice('Configuración guardada.')
        void onSaved().catch(() => {})
      }
    } catch (err) {
      if (alive.current) {
        setError(errorMessage(err))
        setConflict((err as { status?: number }).status === 409)
      }
    } finally {
      working.current = false
      if (alive.current) setSaving(false)
    }
  }
  const reload = async () => {
    try {
      const current = await api.get<NameVoiceStyleSettings>('style')
      if (alive.current) {
        setBase(current)
        setDraft(current.style)
        setModel(current.model)
        setError('')
        setConflict(false)
        setNotice('Configuración recargada.')
      }
    } catch (err) { if (alive.current) setError(errorMessage(err)) }
  }
  return (
    <details open className={styles.styleSettings}>
      <summary>Modelo y estilo de pronunciación (Gemini)</summary>
      <form
        aria-label='Estilo para nombres'
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className={formStyles.field}>
          Modelo para nuevas generaciones
          <select
            value={model}
            disabled={saving}
            onChange={(event) => {
              setModel(event.target.value as NameVoiceModel)
              setNotice('')
            }}
          >
            <option value='gemini-3.8-flash-lite-tts'>Gemini 3.8 Flash TTS · Lite</option>
            <option value='gemini-3.8-flash-tts'>Gemini 3.8 Flash TTS · Normal</option>
          </select>
        </label>
        <div className={formStyles.field}>
          <label htmlFor={styleId}>Estilo para nuevas generaciones</label>
          <textarea
            id={styleId}
            rows={7}
            maxLength={nameVoiceStyleLimit}
            required
            spellCheck={false}
            value={draft}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value)
              setNotice('')
            }}
          />
        </div>
        {error && <p role='alert' className={formStyles.error}>{error}</p>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={saving}>{saving ? 'Guardando…' : 'Guardar configuración'}</Button>
          <Button
            disabled={saving}
            onClick={() => {
              setDraft(base.defaultStyle)
              setNotice('')
            }}
          >
            Cargar estilo predeterminado
          </Button>
          {dirty && (
            <Button
              disabled={saving}
              onClick={() => {
                setDraft(base.style)
                setModel(base.model)
                setError('')
                setConflict(false)
                setNotice('')
              }}
            >
              Descartar cambios
            </Button>
          )}
          {conflict && <Button disabled={saving} onClick={() => void reload()}>Recargar configuración</Button>}
        </div>
        {(notice || saving) && <p role='status' className={formStyles.notice}>{saving ? 'Guardando configuración…' : notice}</p>}
      </form>
    </details>
  )
}
