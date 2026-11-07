import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import YouTubePlayer from 'routes/Player/components/Player/YouTubePlayer/YouTubePlayer'
import type { RequestReceipt } from 'routes/Participant/requests'
import type { SongSearchResult } from 'shared/songSource'
import { previewRestrictionMessage } from './previewAvailability'
import styles from './SongPreviewModal.css'

type PreviewState = 'loading' | 'awaiting-play' | 'ready' | 'error'

export default function SongPreviewModal ({ result, receipt, blocker, onConfirm, onClose, onUnavailable }: {
  result: SongSearchResult
  receipt?: RequestReceipt
  blocker: string | null
  onConfirm: () => void
  onClose: () => void
  onUnavailable: (code: number) => void
}) {
  const messageId = useId()
  const surface = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<PreviewState>('loading')
  const [error, setError] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const sending = submitted && receipt?.phase === 'sending'
  const uncertain = submitted && receipt?.phase === 'uncertain'
  const musicBlocked = receipt?.code === 'MUSIC_BLOCKED'

  useEffect(() => {
    const element = surface.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (state !== 'loading') return
    const timer = setTimeout(() => {
      setError('No se pudo cargar el video. Reintenta.')
      setState('error')
    }, 15000)
    return () => clearTimeout(timer)
  }, [state, attempt])

  const close = () => {
    if (!sending) onClose()
  }
  const retry = () => {
    setError('')
    setState('loading')
    setAttempt(value => value + 1)
  }
  const confirm = () => {
    if (musicBlocked || sending || (!uncertain && (state !== 'ready' || blocker))) return
    setSubmitted(true)
    onConfirm()
  }
  let message = error || blocker || ''
  if (!message && state === 'loading') message = 'Comprobando reproducción…'
  if (!message && state === 'awaiting-play') message = 'Toca el video para reproducir.'
  if (submitted && receipt?.phase === 'error') message = receipt.message || 'No se pudo enviar el pedido. Reintenta.'
  if (uncertain) message = 'Pedido sin confirmar. Pulsa Confirmar para comprobarlo.'
  if (sending) message = 'Enviando pedido…'

  return (
    <Modal
      title={result.title}
      onClose={close}
      className={styles.modal}
      buttons={(
        <>
          <Button className={styles.secondary} variant='default' onClick={close} disabled={sending}>{musicBlocked ? 'Buscar otra canción' : 'Cancelar'}</Button>
          {!musicBlocked && (
            <Button variant='primary' onClick={confirm} disabled={sending || (!uncertain && (state !== 'ready' || !!blocker))} aria-describedby={messageId}>
              {sending ? 'Enviando…' : 'Confirmar'}
            </Button>
          )}
        </>
      )}
    >
      <p className={styles.channel} translate='no'>{result.artistOrChannel}</p>
      <div ref={surface} className={styles.video}>
        {width > 0 && state !== 'error' && (
          <YouTubePlayer
            key={attempt}
            controls={0}
            videoId={result.sourceId}
            mediaKey={attempt}
            width={width}
            height={Math.max(200, Math.round(width * 9 / 16))}
            volume={1}
            isPlaying={!sending && !uncertain}
            onLoad={() => {}}
            onEnd={() => {}}
            onPlay={() => setState('ready')}
            onStatus={({ isPlaying }) => {
              if (isPlaying === false) setState(value => value === 'loading' ? 'awaiting-play' : value)
            }}
            onError={(_, diagnostic) => {
              const code = diagnostic?.category === 'iframe' ? diagnostic.code ?? null : null
              const restriction = previewRestrictionMessage(code)
              setError(restriction || 'No se pudo reproducir el video. Reintenta.')
              setRestricted(!!restriction)
              setState('error')
              if (restriction && code !== null) onUnavailable(code)
            }}
          />
        )}
        {state === 'error' && result.thumbnailUrl && <img src={result.thumbnailUrl} alt='' className={styles.poster} />}
      </div>
      <div id={messageId} role='status' className={styles.message}>{message}</div>
      {state === 'error' && !restricted && <Button className={styles.secondary} variant='default' onClick={retry}>Reintentar</Button>}
    </Modal>
  )
}
