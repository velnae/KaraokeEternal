import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import PlayerTransitionScene from '../../routes/Player/components/Animation/PlayerTransitionScene'
import PlayerTransitionPresentation from '../../routes/Player/components/Animation/PlayerTransitionPresentation'
import { TRANSITION_INTRO_MS } from 'shared/animation'
import { karaokeVideo, type KaraokeBackgroundAsset } from 'shared/karaokeBackgrounds'
import type { CallPart } from 'shared/karaokeCalls'
import type { QueueItem } from 'shared/types'
import styles from './KaraokeCallPilot.css'
import KaraokeCountdown from './KaraokeCountdown'
import { KARAOKE_COUNTDOWN_MS } from 'shared/karaokeStart'

export default function KaraokePreviewPlayer ({ roomId, performer, song, table, venueName, voice, video, bed, volume, dimOpacity }: {
  roomId: number
  performer: string
  song: string
  table: string
  venueName: string
  voice?: CallPart
  video?: KaraokeBackgroundAsset
  bed?: KaraokeBackgroundAsset
  volume: number
  dimOpacity: number
}) {
  const [phase, setPhase] = useState<'idle' | 'intro' | 'voice' | 'waiting' | 'countdown' | 'exiting' | 'finished'>('idle')
  const [seconds, setSeconds] = useState(5)
  const countdownRemaining = useRef(KARAOKE_COUNTDOWN_MS)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const background = useRef<HTMLAudioElement>(null)
  const remaining = useRef(TRANSITION_INTRO_MS)
  const generation = useRef(0)
  const voiceURL = voice ? new URL(`api/rooms/${roomId}/karaoke-calls/audio/${voice.id}`, document.baseURI).href : ''
  const bedURL = bed ? new URL(bed.url, document.baseURI).href : ''
  const incoming: QueueItem = { queueId: -1, songId: null, userId: 0, prevQueueId: null, mediaId: null, rgTrackGain: null, rgTrackPeak: null,
    userDateUpdated: 0, userDisplayName: performer || 'Cantante', mediaType: 'mp4', isVideoKeyingEnabled: false, origin: 'PARTICIPANT', requestIntent: 'SING',
    source: 'LOCAL', status: 'APPROVED', externalId: null, title: song || 'Canción', artistOrChannel: '', durationSeconds: null, thumbnailUrl: null,
    dateCreated: 0, dateUpdated: 0, tableLabelSnapshot: table }
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
    if (!playing || phase !== 'intro') return
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
  }, [playing, phase, run])
  useEffect(() => {
    let active = true
    const speech = audio.current
    const music = background.current
    if (music) music.volume = volume
    const fail = () => {
      if (active) {
        setPlaying(false)
        setError('No se pudo reproducir la voz. Prepare el audio y reintente.')
      }
    }
    if (playing && ['intro', 'voice', 'waiting', 'countdown'].includes(phase)) {
      if (bed) void music?.play().catch(() => {
        if (active) setError('El fondo no está disponible. La prueba continúa sin acompañamiento.')
      })
      if (phase === 'voice') void speech?.play().catch(fail)
    } else {
      speech?.pause()
      if (phase !== 'exiting') music?.pause()
    }
    return () => {
      active = false
      speech?.pause()
    }
  }, [playing, phase, run, bed, volume])
  useEffect(() => {
    if (!playing || phase !== 'countdown') return
    const began = performance.now()
    const initial = countdownRemaining.current
    const timer = setInterval(() => {
      const left = Math.max(0, initial - (performance.now() - began))
      setSeconds(Math.ceil(left / 1000))
      if (!left) setPhase('exiting')
    }, 50)
    return () => {
      clearInterval(timer)
      countdownRemaining.current = Math.max(0, initial - (performance.now() - began))
    }
  }, [playing, phase])
  useEffect(() => {
    if (phase !== 'exiting') return
    const began = performance.now()
    const timer = setInterval(() => {
      if (background.current) background.current.volume = volume * Math.max(0, 1 - (performance.now() - began) / 1000)
    }, 25)
    return () => clearInterval(timer)
  }, [phase, volume])
  const restart = () => {
    generation.current++
    remaining.current = TRANSITION_INTRO_MS
    for (const element of [audio.current, background.current]) {
      element?.pause()
      if (element) element.currentTime = 0
    }
    setError('')
    setRun(value => value + 1)
    setPhase('intro')
    setPlaying(true)
  }
  const startCountdown = () => {
    audio.current?.pause()
    countdownRemaining.current = KARAOKE_COUNTDOWN_MS
    setSeconds(5)
    setError('')
    setPhase('countdown')
    setPlaying(true)
  }
  return (
    <section aria-label='Previsualización audiovisual'>
      <div className={styles.previewStage}>
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
          {phase !== 'countdown' && <PlayerTransitionPresentation incoming={incoming} venueName={venueName} greeting={null} onGreetingMounted={() => {}} />}
          {phase === 'countdown' && <KaraokeCountdown seconds={seconds} />}
        </PlayerTransitionScene>
      </div>
      <p role='status'>{({ idle: 'Previsualización en este dispositivo', intro: 'Entrada', voice: 'Llamado', waiting: 'Esperando inicio', countdown: 'Cuenta regresiva', exiting: 'Salida', finished: 'Previsualización finalizada' })[phase]}</p>
      {error && <p role='alert'>{error}</p>}
      {!voice && <p role='status'>Prepare el audio del llamado para reproducir la secuencia.</p>}
      <div className={styles.actions}>
        <Button
          variant='primary'
          disabled={!voice || phase === 'exiting'}
          onClick={() => {
            if (phase === 'waiting') startCountdown()
            else if (phase === 'idle' || phase === 'finished') restart()
            else setPlaying(value => !value)
          }}
        >
          {phase === 'waiting' ? 'Iniciar karaoke' : playing ? 'Pausar' : 'Reproducir'}
        </Button>
        <Button disabled={!voice || phase === 'exiting'} onClick={restart}>Reiniciar</Button>
        {(phase === 'idle' || phase === 'finished') && <Button onClick={startCountdown}>Probar cuenta regresiva</Button>}
      </div>
      <audio ref={audio} src={voiceURL || undefined} preload='auto' onEnded={() => setPhase('waiting')} onError={() => setError('No se pudo abrir el audio del llamado. Prepare una nueva prueba.')} />
      <audio ref={background} src={bedURL || undefined} preload='auto' loop onError={() => setError('No se pudo abrir el fondo. La prueba continúa sin acompañamiento.')} />
    </section>
  )
}
