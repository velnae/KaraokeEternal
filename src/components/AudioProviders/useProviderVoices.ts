import { useEffect, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import type { ProviderUse, VoiceOption } from 'shared/audioProviders'
import type { AudioKind } from 'shared/animation'

const api = new HttpApi('audio-providers/')
export default function useProviderVoices ({ providerId, use, model, language = '', kind = 'voice', enabled = true }: {
  providerId: string
  use: ProviderUse
  model: string
  language?: string
  kind?: AudioKind
  enabled?: boolean
}) {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([providerId, use, model, language, kind, enabled, attempt])
  const [result, setResult] = useState<{ key: string, voices: VoiceOption[], error?: string } | null>(null)
  useEffect(() => {
    if (!enabled || !providerId || !model) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ use, model, language, kind })
      void api.get<{ voices: VoiceOption[] }>(`${providerId}/voices?${query}`, { signal: controller.signal }).then((value): void => {
        if (active) setResult({ key, voices: value.voices })
        return undefined
      }).catch((error) => { if (active) setResult({ key, voices: [], error: error.message }) })
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [providerId, use, model, language, kind, enabled, key])
  return {
    voices: result?.key === key ? result.voices : [],
    loading: enabled && !!providerId && !!model && result?.key !== key,
    error: result?.key === key ? result.error : undefined,
    retry: () => setAttempt(value => value + 1),
  }
}
