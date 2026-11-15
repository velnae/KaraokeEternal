import { useCallback, useEffect, useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import type { KaraokeBackgroundAsset, KaraokeBackgroundKind, KaraokeBackgroundOverview, KaraokeBackgroundSettings } from 'shared/karaokeBackgrounds'

const api = new HttpApi()
export default function useKaraokeBackgrounds (roomId: number) {
  const base = `rooms/${roomId}/karaoke-calls/backgrounds`
  const [overview, setOverview] = useState<KaraokeBackgroundOverview | null>(null)
  const [draft, setDraft] = useState<KaraokeBackgroundSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const working = useRef(false)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    const result = await api.get<KaraokeBackgroundOverview>(base)
    if (mounted.current) {
      setOverview(result)
      setDraft(previous => previous ?? result.settings)
    }
  }, [base])
  useEffect(() => {
    mounted.current = true
    void refresh().catch((failure) => {
      if (mounted.current) setError(failure.message)
    })
    return () => {
      mounted.current = false
    }
  }, [refresh])
  const act = async (operation: () => Promise<void>) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message)
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const accept = (result: KaraokeBackgroundOverview) => {
    if (!mounted.current) return
    setOverview(result)
    setDraft(result.settings)
  }
  const upload = (kind: KaraokeBackgroundKind, file: File) => act(async () => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('requestId', crypto.randomUUID())
    form.append('file', file)
    const asset = await api.post<KaraokeBackgroundAsset>(`${base}/upload`, { body: form })
    await refresh()
    if (asset.state === 'failed') throw new Error(asset.error || 'No se pudo preparar el archivo. Vuelva a subirlo.')
    if (mounted.current) setNotice('Fondo preparado. Actívelo para utilizarlo.')
  })
  const activate = (id: string, active: boolean) => act(async () => {
    const result = await api.request<KaraokeBackgroundOverview>('PATCH', `${base}/assets/${id}`, { body: { active } })
    // Keep unsaved selections while advancing their optimistic concurrency token.
    if (mounted.current) {
      setOverview(result)
      setDraft(previous => previous ? { ...previous, revision: result.settings.revision } : result.settings)
    }
  })
  const save = () => act(async () => {
    accept(await api.put<KaraokeBackgroundOverview>(base, { body: draft }))
    if (mounted.current) setNotice('Fondos guardados.')
  })
  const reload = () => act(async () => {
    accept(await api.get<KaraokeBackgroundOverview>(base))
  })
  return { overview, draft, setDraft, busy, error, notice, upload, activate, save, reload }
}
