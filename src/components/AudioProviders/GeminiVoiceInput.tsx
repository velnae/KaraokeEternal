import React, { useEffect, useId, useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import type { VoiceOption } from 'shared/audioProviders'

const api = new HttpApi('audio-providers/')

export default function GeminiVoiceInput ({ value, model, onChange, disabled, label = 'Nombre exacto de la voz' }: { value: string, model: string, onChange(value: string): void, disabled?: boolean, label?: string }) {
  const id = useId()
  const request = useRef<AbortController | null>(null)
  const key = JSON.stringify([value, model])
  const [result, setResult] = useState<{ key: string, message: string, error?: boolean } | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    request.current?.abort()
  }, [key])
  const validate = async () => {
    request.current?.abort()
    if (!value.trim() || !model) return
    const controller = new AbortController()
    request.current = controller
    setResult({ key, message: 'Validando voz…' })
    try {
      const voice = await api.post<VoiceOption>('gemini/resolve-voice', { body: { voice: value, model }, signal: controller.signal })
      if (!controller.signal.aborted) setResult({ key, message: `Voz válida: ${voice.name}` })
    } catch (error) {
      if (!controller.signal.aborted) setResult({ key, message: (error as Error).message, error: true })
    }
  }
  const current = result?.key === key ? result : null
  return (
    <>
      <input
        type='text'
        value={value}
        required
        maxLength={120}
        placeholder='Escribe el nombre exacto, p. ej. Orus'
        autoComplete='off'
        spellCheck={false}
        disabled={disabled}
        aria-label={label}
        aria-describedby={current ? id : undefined}
        aria-invalid={current?.error || undefined}
        onChange={event => onChange(event.target.value)}
        onBlur={() => void validate()}
      />
      {current && <span id={id} role={current.error ? 'alert' : 'status'}>{current.message}</span>}
    </>
  )
}
