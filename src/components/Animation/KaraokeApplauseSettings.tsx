import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import { karaokeEffect } from 'shared/karaokeBackgrounds'
import { karaokeCueClip, karaokeCueDuration, karaokeCueSegment } from 'shared/karaokeStage'
import AnnouncementAudio from '../../routes/Player/components/Animation/AnnouncementAudio'
import type useKaraokeBackgrounds from './useKaraokeBackgrounds'
import styles from './KaraokeCallPilot.css'

type Slot = 'countdownEffectId' | 'endedEffectId'
const seconds = (value: number) => (value / 1000).toLocaleString('es', { maximumFractionDigits: 2 })

export default function KaraokeApplauseSettings ({ state }: { state: ReturnType<typeof useKaraokeBackgrounds> }) {
  const { draft, overview, busy, setDraft, upload } = state
  const [channel] = useState(() => new AnnouncementAudio())
  const [listening, setListening] = useState<Slot | null>(null)
  const [error, setError] = useState('')
  const version = useRef(0)
  const completion = useRef<Promise<unknown> | null>(null)
  useEffect(() => () => {
    version.current++
    channel.close()
  }, [channel])
  const stop = () => {
    version.current++
    channel.stopForeground('private-applause-stop')
    setListening(null)
  }
  const listen = async (slot: Slot) => {
    if (listening === slot) {
      stop()
      return
    }
    const asset = overview?.assets.find(asset => asset.id === draft?.[slot] && asset.kind === 'effect' && asset.state === 'ready')
    if (!asset) return
    stop()
    const token = version.current
    setListening(slot)
    setError('')
    try {
      await channel.resume()
      await completion.current
      const clip = karaokeCueClip(karaokeEffect(asset), slot === 'countdownEffectId' ? 'countdown' : 'ended')
      await channel.prepare([clip], 'karaoke')
      if (token !== version.current) return
      completion.current = channel.play(clip.checksum, draft?.effectVolume ?? 0.5, karaokeCueSegment(clip))
      await completion.current
    } catch {
      if (token === version.current) setError('No se pudo escuchar el aplauso. Vuelva a intentar.')
    } finally {
      if (token === version.current) setListening(null)
    }
  }
  if (!draft || !overview) return null
  const effects = overview.assets.filter(asset => asset.kind === 'effect')
  return (
    <fieldset className={styles.section} disabled={busy}>
      <legend>Aplausos</legend>
      {error && <p role='alert'>{error}</p>}
      <div className={styles.grid}>
        {(['countdownEffectId', 'endedEffectId'] as const).map((slot) => {
          const start = slot === 'countdownEffectId'
          const selected = effects.find(asset => asset.id === draft[slot])
          const ready = selected?.state === 'ready'
          const label = start ? 'Aplauso de inicio' : 'Aplauso de cierre'
          return (
            <div key={slot}>
              <label className={styles.field}>
                {label}
                <select
                  aria-label={label}
                  value={draft[slot] ?? ''}
                  onChange={(event) => {
                    stop()
                    setDraft({ ...draft, [slot]: event.target.value || null })
                  }}
                >
                  <option value=''>Sin aplauso</option>
                  {effects.map(asset => (
                    <option key={asset.id} value={asset.id} disabled={asset.state !== 'ready'}>
                      {`${asset.title}${asset.state === 'ready' ? ` — ${seconds(asset.durationMs!)} s` : ' — No disponible'}`}
                    </option>
                  ))}
                </select>
              </label>
              {ready && <p>{start ? `Al comenzar el conteo · completo (${seconds(karaokeCueDuration(karaokeCueClip(karaokeEffect(selected!), 'countdown')))} s)` : `Al terminar la canción · completo (${seconds(selected!.durationMs!)} s)`}</p>}
              <Button disabled={!ready} onClick={() => void listen(slot)}>{listening === slot ? 'Detener prueba' : start ? 'Escuchar inicio' : 'Escuchar cierre'}</Button>
              <label className={styles.field}>
                {start ? 'Subir aplauso de inicio' : 'Subir aplauso de cierre'}
                <input
                  type='file'
                  accept='audio/mpeg,audio/wav,audio/ogg'
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    stop()
                    void upload('effect', file).then((asset): void => {
                      if (asset) setDraft(current => current ? { ...current, [slot]: asset.id } : current)
                      return undefined
                    })
                  }}
                />
              </label>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
