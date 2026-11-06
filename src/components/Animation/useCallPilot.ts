import { useCallback, useEffect, useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import type { CallControls, CallJob, CallSnapshot } from 'shared/karaokeCalls'

const api = new HttpApi()
export default function useCallPilot (roomId: number) {
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const alive = useRef(false)
  const working = useRef(false)
  const sequence = useRef(0)
  const retry = useRef<{ signature: string, requestId: string } | null>(null)
  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const result = await api.get<CallSnapshot>(`rooms/${roomId}/karaoke-calls`)
      if (alive.current && current === sequence.current) setSnapshot(result)
    } catch (err) {
      if (alive.current && current === sequence.current) setError((err as Error).message)
    }
  }, [roomId])
  useEffect(() => {
    alive.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout>
    // Schedule after completion: a slow tunnel must not invalidate every response.
    const poll = async () => {
      await refresh()
      if (active) timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => {
      alive.current = false
      active = false
      clearInterval(timer)
    }
  }, [refresh])
  const submit = async (suffix: string, body: object) => {
    if (working.current) return false
    working.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const signature = JSON.stringify([roomId, suffix, body])
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() }
    try {
      const result = await api.post<CallJob>(`rooms/${roomId}/${suffix}`, { body: { ...body, requestId: retry.current.requestId } })
      retry.current = null
      if (alive.current) setNotice(`Preparación recibida. ${result.status === 'ready' ? 'Audio disponible.' : 'Puede seguir usando la aplicación.'}`)
      await refresh()
      return true
    } catch (err) {
      if (alive.current) setError((err as Error).message)
      return false
    } finally {
      working.current = false
      if (alive.current) setBusy(false)
    }
  }
  const cancel = async (id: string) => {
    try {
      await api.post(`rooms/${roomId}/karaoke-calls/jobs/${id}/cancel`)
      await refresh()
    } catch (err) { if (alive.current) setError((err as Error).message) }
  }
  const configure = async (controls: CallControls) => {
    if (working.current) return false
    working.current = true
    setBusy(true)
    setError('')
    try {
      await api.put(`rooms/${roomId}/karaoke-calls/automation`, { body: controls })
      if (alive.current) setNotice(controls.enabled ? 'Los llamados se prepararán y anunciarán automáticamente.' : 'Configuración de llamados guardada.')
      await refresh()
      return true
    } catch (err) {
      if (alive.current) setError((err as Error).message)
      await refresh()
      return false
    } finally {
      working.current = false
      if (alive.current) setBusy(false)
    }
  }
  let unavailable = ''
  if (!snapshot) unavailable = 'Cargando el perfil de voz…'
  else if (snapshot.error) unavailable = snapshot.error
  else if (!snapshot.voice.configured) unavailable = 'Configure Gemini en Voz de saludos antes de generar.'
  else if (['limited', 'error', 'checking', 'generating'].includes(snapshot.voice.state)) unavailable = snapshot.voice.message
  return { snapshot, error, busy, notice, submit, cancel, configure, refresh, unavailable }
}
