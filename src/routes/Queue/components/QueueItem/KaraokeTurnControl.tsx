import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import { useAppSelector } from 'store/hooks'
import { animationRequest, animationTime } from 'lib/animationApi'
import { KARAOKE_TURN, karaokeCountdownSeconds } from 'shared/karaokeStart'
import styles from './QueueItem.css'

export default function KaraokeTurnControl ({ queueId }: { queueId: number }) {
  const turn = useAppSelector(state => state.animation.snapshot?.karaokeTurn?.queueId === queueId ? state.animation.snapshot.karaokeTurn : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, tick] = useState(0)
  useEffect(() => {
    if (turn?.phase !== 'countdown') return
    const timer = setInterval(() => tick(value => value + 1), 200)
    return () => clearInterval(timer)
  }, [turn?.phase])
  if (!turn) return null
  const execute = async (operation: 'start' | 'cancel') => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await animationRequest(KARAOKE_TURN, { ...turn, operation }, 5000)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.karaokeStart} aria-label='Inicio del turno de karaoke'>
      <span role='status'>{turn.phase === 'presenting' ? 'Presentando karaoke…' : turn.phase === 'released' ? 'Preparando canción…' : turn.phase === 'countdown' ? `Comienza en ${karaokeCountdownSeconds(turn.endsAt!, animationTime())}…` : 'Esperando inicio'}</span>
      {turn.phase === 'waiting' && <Button variant='primary' disabled={busy || !turn.playerPresent} onClick={() => void execute('start')}>Iniciar karaoke</Button>}
      {turn.phase === 'countdown' && <Button disabled={busy} onClick={() => void execute('cancel')}>Cancelar inicio</Button>}
      {!turn.playerPresent && <p role='status'>Abra el reproductor para continuar.</p>}
      {error && <p role='alert'>{error}</p>}
    </div>
  )
}
