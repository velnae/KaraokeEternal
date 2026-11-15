import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'

const api = new HttpApi('audio-providers/')
export default function GeminiVoicePreview ({ model, voice, style, use }: { model: string, voice: string, style: string, use: 'calls' | 'names' }) {
  const key = JSON.stringify([model, voice, style, use])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ key: string, url: string } | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => operation.current?.abort(), [])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url)
  }, [preview])
  const generate = async () => {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    const timer = setTimeout(() => controller.abort(), 120000)
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      const response = await api.post<Response>('gemini/preview', { body: { model, voice, style, use }, signal: controller.signal })
      const blob = await response.blob()
      if (!controller.signal.aborted) setPreview({ key, url: URL.createObjectURL(blob) })
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message)
      else setError('La prueba no se confirmó a tiempo. Revise el estado antes de volver a generar.')
    } finally {
      clearTimeout(timer)
      operation.current = null
      setBusy(false)
    }
  }
  return (
    <section aria-label='Prueba de voz' aria-busy={busy}>
      <Button disabled={busy} onClick={() => void generate()}>{busy ? 'Generando…' : 'Generar prueba de voz'}</Button>
      <p>La prueba se escucha en este navegador y consume una generación.</p>
      {busy && <p role='status'>Preparando el audio de prueba…</p>}
      {error && <p role='alert'>{error}</p>}
      {preview?.key === key && <audio aria-label='Audio de prueba' controls src={preview.url} />}
    </section>
  )
}
