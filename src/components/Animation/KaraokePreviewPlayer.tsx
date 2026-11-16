import React, { useCallback, useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import PlayerTransitionScene from '../../routes/Player/components/Animation/PlayerTransitionScene'
import PlayerTransitionPresentation from '../../routes/Player/components/Animation/PlayerTransitionPresentation'
import { karaokeEffect, karaokeVideo, type KaraokeBackgroundAsset, type KaraokeBackgroundSettings } from 'shared/karaokeBackgrounds'
import type { CallPart } from 'shared/karaokeCalls'
import type { QueueItem } from 'shared/types'
import styles from './KaraokeCallPilot.css'
import KaraokeCountdown from './KaraokeCountdown'
import { KARAOKE_COUNTDOWN_MS } from 'shared/karaokeStart'
import { KARAOKE_ENTRY_ATTACK_MS, KARAOKE_FADE_MS, KARAOKE_REMINDER_MS, karaokeCueClip, karaokeCueDuration, karaokeCueSegment, type KaraokeCueClip } from 'shared/karaokeStage'
import AnnouncementAudio from '../../routes/Player/components/Animation/AnnouncementAudio'
import KaraokeMascot from './KaraokeMascot'
import { useAppSelector } from 'store/hooks'
import { createTransitionPresentationSelector } from '../../routes/Player/components/Animation/transitionPresentation'
import { ensureState } from 'redux-optimistic-ui'

export default function KaraokePreviewPlayer ({ roomId, performer, song, artist, table, venueName, voice, video, bed, volume, dimOpacity, settings, assets, tableVoice, reminder }: {
  roomId: number
  performer: string
  song: string
  artist: string
  table: string
  venueName: string
  voice?: CallPart
  video?: KaraokeBackgroundAsset
  bed?: KaraokeBackgroundAsset
  volume: number
  dimOpacity: number
  settings?: KaraokeBackgroundSettings
  assets: KaraokeBackgroundAsset[]
  tableVoice?: CallPart
  reminder?: CallPart
}) {
  const [phase, setPhase] = useState<'idle' | 'intro' | 'voice' | 'waiting' | 'countdown' | 'loading' | 'exiting' | 'finished' | 'closing'>('idle')
  const [expanded, setExpanded] = useState(false)
  const expandOpener = useRef<HTMLElement | null>(null)
  const [clipURL, setClipURL] = useState('')
  const sampleVideo = useRef<HTMLVideoElement>(null)
  const [channel] = useState(() => new AnnouncementAudio())
  const cueRun = useRef(0)
  const cueBusy = useRef(false)
  const cueCompletion = useRef<Promise<unknown> | null>(null)
  const reminderPlayback = useRef<() => void>(() => {})
  const [ducking, setDucking] = useState(false)
  const [introCuePending, setIntroCuePending] = useState(false)
  const prefs = useAppSelector(state => state.prefs)
  const roomPrefs = useAppSelector(state => state.rooms.entities[roomId]?.prefs)
  const [selectPresentation] = useState(createTransitionPresentationSelector)
  const presentation = useAppSelector(state => selectPresentation({ queue: ensureState(state.queue), player: state.status, preferences: state.rooms.entities[roomId]?.prefs?.queue, loading: false }))
  const effect = useCallback((key: 'entryEffectId' | 'countdownEffectId' | 'endedEffectId' | 'reminderEffectId') => {
    const selected = assets.find(asset => asset.id === settings?.[key] && asset.kind === 'effect' && asset.state === 'ready' && asset.active)
    if (!selected) return null
    const clip = { ...karaokeEffect(selected), volume: settings?.effectVolume ?? 0.5 }
    return key === 'countdownEffectId' ? karaokeCueClip(clip, 'countdown') : key === 'endedEffectId' ? karaokeCueClip(clip, 'ended') : clip
  }, [assets, settings])
  const playCue = useCallback(async (clips: KaraokeCueClip[], duck = false, deadline = Infinity, entrance = false) => {
    if (!clips.length || cueBusy.current) return
    cueBusy.current = true
    const token = cueRun.current
    try {
      await channel.resume()
      await cueCompletion.current
      if (token !== cueRun.current) return
      const prepared = await Promise.all(clips.map(async (clip) => {
        if (clip.checksum) return clip
        const response = await fetch(new URL(clip.url!, document.baseURI))
        if (!response.ok) throw new Error('El audio no está disponible.')
        const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
        return { ...clip, checksum: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') }
      }))
      if (token !== cueRun.current) return
      await channel.prepare(prepared, 'karaoke')
      if (token !== cueRun.current) return
      if (duck) setDucking(true)
      for (const clip of prepared) {
        if (token !== cueRun.current || performance.now() + karaokeCueDuration(clip) > deadline) return
        const level = clip.volume ?? roomPrefs?.animation?.volume ?? 0.5
        const completion = entrance ? channel.playEffect(clip.checksum, level) : channel.play(clip.checksum, level, karaokeCueSegment(clip))
        if (entrance) setIntroCuePending(false)
        cueCompletion.current = completion
        if (await completion !== 'ENDED') return
      }
    } catch {
      if (token === cueRun.current) setError('No se pudo escuchar el efecto. La prueba continúa.')
    } finally {
      if (token === cueRun.current) {
        cueBusy.current = false
        setDucking(false)
      }
    }
  }, [channel, roomPrefs?.animation?.volume])
  const stopCue = () => {
    cueRun.current++
    cueBusy.current = false
    setDucking(false)
    setIntroCuePending(false)
    channel.stopForeground('private-preview-command')
  }
  const [seconds, setSeconds] = useState(KARAOKE_COUNTDOWN_MS / 1000)
  const countdownRemaining = useRef(KARAOKE_COUNTDOWN_MS)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const background = useRef<HTMLAudioElement>(null)
  const remaining = useRef(0)
  const generation = useRef(0)
  const voiceURL = voice ? new URL(`api/rooms/${roomId}/karaoke-calls/audio/${voice.id}`, document.baseURI).href : ''
  const bedURL = bed ? new URL(bed.url, document.baseURI).href : ''
  const incoming: QueueItem = { queueId: -1, songId: null, userId: 0, prevQueueId: null, mediaId: null, rgTrackGain: null, rgTrackPeak: null,
    userDateUpdated: 0, userDisplayName: performer || 'Cantante', mediaType: 'mp4', isVideoKeyingEnabled: false, origin: 'PARTICIPANT', requestIntent: 'SING',
    source: 'LOCAL', status: 'APPROVED', externalId: null, title: song || 'Canción', artistOrChannel: artist, durationSeconds: null, thumbnailUrl: null,
    dateCreated: 0, dateUpdated: 0, tableLabelSnapshot: table }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded) {
        event.preventDefault()
        event.stopPropagation()
        setExpanded(false)
        expandOpener.current?.focus()
      }
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [expanded])
  useEffect(() => () => {
    cueRun.current++
    channel.close()
  }, [channel])
  useEffect(() => () => {
    if (clipURL) URL.revokeObjectURL(clipURL)
  }, [clipURL])
  useEffect(() => {
    const voice = audio.current
    const bed = background.current
    // StrictMode replays cleanup on the same elements, so restore their sources.
    if (voice && voiceURL) voice.src = voiceURL
    if (bed && bedURL) bed.src = bedURL
    return () => {
      for (const element of [voice, bed]) {
        element?.pause()
        element?.removeAttribute('src')
        element?.load()
      }
    }
  }, [voiceURL, bedURL])
  useEffect(() => {
    if (!playing || phase !== 'intro' || introCuePending) return
    const epoch = generation.current
    const began = performance.now()
    const timer = setTimeout(() => setPhase('voice'), Math.max(0, remaining.current))
    return () => {
      clearTimeout(timer)
      // The generation is a restart token, not a DOM ref; an older run must not
      // subtract elapsed time from the replacement run's intro budget.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (generation.current === epoch) remaining.current = Math.max(0, remaining.current - (performance.now() - began))
    }
  }, [playing, phase, run, introCuePending])
  useEffect(() => {
    let active = true
    const speech = audio.current
    const music = background.current
    if (music && phase !== 'countdown') music.volume = volume
    const fail = () => {
      if (active) {
        setPlaying(false)
        setError('No se pudo reproducir la voz. Prepare el audio y reintente.')
      }
    }
    if (playing && ['intro', 'voice', 'waiting'].includes(phase)) {
      if (bed) void music?.play().catch(() => {
        if (active) setError('El fondo no está disponible. La prueba continúa sin acompañamiento.')
      })
      if (phase === 'voice') void speech?.play().catch(fail)
    } else {
      speech?.pause()
      if (phase !== 'countdown' && phase !== 'exiting') music?.pause()
    }
    return () => {
      active = false
      speech?.pause()
    }
  }, [playing, phase, run, bed, volume])
  useEffect(() => {
    // Polling replaces these objects even when their IDs are unchanged. Keep
    // current audio inputs separate from the lifetime of the waiting clock.
    reminderPlayback.current = () => {
      if (!tableVoice) return
      const outro = effect('reminderEffectId') ?? (reminder ? { id: reminder.id, title: reminder.title, displayText: '', kind: 'voice' as const, checksum: '', durationMs: reminder.durationMs, source: 'Karaoke', license: '', url: `api/rooms/${roomId}/karaoke-calls/audio/${reminder.id}` } : null)
      if (!outro) return
      const tableClip = { id: tableVoice.id, title: tableVoice.title, displayText: '', kind: 'voice' as const, checksum: '', durationMs: tableVoice.durationMs, source: 'Karaoke', license: '', url: `api/rooms/${roomId}/karaoke-calls/audio/${tableVoice.id}` }
      void playCue([tableClip, outro], true)
    }
  }, [tableVoice, reminder, effect, playCue, roomId])
  useEffect(() => {
    if (!playing || phase !== 'waiting') return
    const timer = setInterval(() => reminderPlayback.current(), KARAOKE_REMINDER_MS)
    return () => clearInterval(timer)
  }, [playing, phase, run])
  useEffect(() => {
    const music = background.current
    if (!music || phase !== 'waiting') return
    const from = music.volume
    const to = volume * (ducking ? 0.25 : 1)
    const began = performance.now()
    const timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - began) / 250)
      music.volume = from + (to - from) * progress
      if (progress === 1) clearInterval(timer)
    }, 25)
    return () => clearInterval(timer)
  }, [ducking, phase, volume])
  useEffect(() => {
    if (!playing || phase !== 'countdown') return
    const began = performance.now()
    const initial = countdownRemaining.current
    const timer = setInterval(() => {
      const left = Math.max(0, initial - (performance.now() - began))
      setSeconds(Math.ceil(left / 1000))
      if (!left) {
        if (clipURL && sampleVideo.current) {
          setPhase('loading')
          void sampleVideo.current.play().catch(() => setError('No se pudo abrir el videoclip de prueba.'))
        } else setPhase('exiting')
      }
    }, 50)
    return () => {
      clearInterval(timer)
      countdownRemaining.current = Math.max(0, initial - (performance.now() - began))
    }
  }, [playing, phase, clipURL])
  useEffect(() => {
    if (phase !== 'countdown') return
    const began = performance.now()
    const timer = setInterval(() => {
      const gain = Math.max(0, 1 - (performance.now() - began) / KARAOKE_FADE_MS)
      if (background.current) {
        background.current.volume = volume * gain
        if (!gain) {
          background.current.pause()
          clearInterval(timer)
        }
      }
    }, 25)
    return () => clearInterval(timer)
  }, [phase, volume])
  const unlockReminder = () => {
    void channel.resume().catch(() => setError('No se pudo activar el sonido. Pulse Probar espera para reintentar.'))
  }
  const restart = () => {
    stopCue()
    sampleVideo.current?.pause()
    generation.current++
    const entry = effect('entryEffectId')
    remaining.current = entry ? KARAOKE_ENTRY_ATTACK_MS : 0
    for (const element of [audio.current, background.current]) {
      element?.pause()
      if (element) element.currentTime = 0
    }
    setError('')
    unlockReminder()
    setRun(value => value + 1)
    setPhase('intro')
    setPlaying(true)
    if (entry) {
      const token = cueRun.current
      setIntroCuePending(true)
      void playCue([entry], false, Infinity, true).finally(() => {
        if (token === cueRun.current) setIntroCuePending(false)
      })
    }
  }
  const startCountdown = () => {
    stopCue()
    audio.current?.pause()
    countdownRemaining.current = KARAOKE_COUNTDOWN_MS
    setSeconds(KARAOKE_COUNTDOWN_MS / 1000)
    setError('')
    setPhase('countdown')
    setPlaying(true)
    const applause = effect('countdownEffectId')
    if (applause) void playCue([applause])
  }
  const closeSong = async () => {
    stopCue()
    const token = cueRun.current
    sampleVideo.current?.pause()
    audio.current?.pause()
    background.current?.pause()
    setPhase('closing')
    const applause = effect('endedEffectId')
    if (applause) await playCue([applause])
    if (token === cueRun.current) {
      setPhase('finished')
      setPlaying(false)
    }
  }
  return (
    <section aria-label='Previsualización audiovisual'>
      <div className={styles.previewStage} data-expanded={expanded}>
        <div className={styles.previewClip} data-active={['loading', 'exiting', 'finished', 'closing'].includes(phase)}>
          <strong>{song || 'Videoclip de prueba'}</strong>
          <span>{performer}</span>
        </div>
        {clipURL && <video ref={sampleVideo} className={styles.sampleVideo} src={clipURL} preload='auto' playsInline onPlaying={() => setPhase(current => current === 'loading' ? 'exiting' : current)} onEnded={() => void closeSong()} />}
        {phase !== 'finished' && phase !== 'closing' && (
          <PlayerTransitionScene
            key={run}
            sceneId={`private-${run}`}
            background={video ? { resource: karaokeVideo(video), dimOpacity, revision: 0 } : null}
            playing={playing}
            exiting={phase === 'exiting'}
            onExited={() => {
              setPhase('finished')
              setPlaying(false)
            }}
          >
            {phase !== 'countdown' && <PlayerTransitionPresentation incoming={incoming} upcoming={presentation.incoming ? [presentation.incoming, ...presentation.upcoming].slice(0, 3) : []} venueName={venueName} greeting={null} onGreetingMounted={() => {}} />}
            {phase === 'countdown' && <KaraokeCountdown seconds={seconds} />}
            <KaraokeMascot imageId={settings?.mascotImageId ?? prefs.playerDisplay.logo.animatedImageId ?? prefs.playerDisplay.logo.staticImageId} fallback={prefs.branding.logoSrc} />
          </PlayerTransitionScene>
        )}
        {expanded && (
          <Button
            className={styles.collapsePreview}
            onClick={() => {
              setExpanded(false)
              expandOpener.current?.focus()
            }}
          >
            Reducir
          </Button>
        )}
      </div>
      <p role='status'>{({ idle: 'Previsualización en este dispositivo', intro: 'Entrada', voice: 'Llamado', waiting: 'Esperando inicio', countdown: 'Cuenta regresiva', loading: 'Preparando videoclip de prueba…', exiting: 'Salida', finished: 'Previsualización finalizada', closing: 'Aplauso de cierre' })[phase]}</p>
      {error && <p role='alert'>{error}</p>}
      {!voice && <p role='status'>Prepare el audio del llamado para reproducir la secuencia.</p>}
      <div className={styles.actions}>
        <Button
          variant='primary'
          disabled={!voice || phase === 'exiting'}
          onClick={() => {
            if (phase === 'waiting') startCountdown()
            else if (phase === 'idle' || phase === 'finished') restart()
            else {
              stopCue()
              setPlaying(value => !value)
            }
          }}
        >
          {phase === 'waiting' ? 'Iniciar karaoke' : playing ? 'Pausar' : 'Reproducir'}
        </Button>
        <Button disabled={!voice || phase === 'exiting'} onClick={restart}>Reiniciar</Button>
        {(phase === 'idle' || phase === 'finished') && <Button onClick={startCountdown}>Probar cuenta regresiva</Button>}
        <Button
          onClick={(event) => {
            expandOpener.current = event.currentTarget
            setExpanded(value => !value)
          }}
        >
          {expanded ? 'Reducir' : 'Ampliar'}
        </Button>
        <Button
          onClick={() => {
            stopCue()
            setError('')
            unlockReminder()
            audio.current?.pause()
            setRun(value => value + 1)
            setPhase('waiting')
            setPlaying(true)
          }}
        >
          Probar espera
        </Button>
        <Button onClick={() => void closeSong()}>Probar cierre</Button>
      </div>
      <details className={styles.requestDetails}>
        <summary>Videoclip de prueba</summary>
        <label className={styles.field}>
          Video local
          <input
            type='file'
            accept='video/*'
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) setClipURL(URL.createObjectURL(file))
            }}
          />
        </label>
      </details>
      <audio ref={audio} src={voiceURL || undefined} preload='auto' onEnded={() => setPhase('waiting')} onError={() => setError('No se pudo abrir el audio del llamado. Prepare una nueva prueba.')} />
      <audio ref={background} src={bedURL || undefined} preload='auto' loop onError={() => setError('No se pudo abrir el fondo. La prueba continúa sin acompañamiento.')} />
    </section>
  )
}
