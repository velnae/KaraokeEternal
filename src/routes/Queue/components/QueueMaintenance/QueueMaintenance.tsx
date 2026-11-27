import React, { useRef, useState } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { usePlaylists } from 'components/Playlists/usePlaylists'
import { useConnection } from 'routes/Participant/useConnection'
import { queuePush } from '../../modules/queue'
import { QUEUE_CLEANUP } from 'shared/actionTypes'
import type { QueueCleanupRequest, QueueCleanupResult } from 'shared/queueCleanup'
import styles from './QueueMaintenance.css'

function restore (key: string): QueueCleanupRequest | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    return saved && ['pending', 'history'].includes(saved.operation) && /^[a-zA-Z0-9-]{16,64}$/.test(saved.requestId)
      && Number.isSafeInteger(saved.throughQueueId) && saved.throughQueueId >= 0 && Number.isFinite(saved.expiresAt)
      ? saved
      : null
  } catch { return null }
}

export default function QueueMaintenance () {
  const { roomId, userId } = useAppSelector(state => state.user)
  const queue = useAppSelector(state => ensureState(state.queue))
  const connected = useConnection()
  const dispatch = useAppDispatch()
  const key = `queue-cleanup:${roomId}:${userId}`
  const [pending, setPending] = useState<QueueCleanupRequest | null>(() => restore(key))
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const clearPending = () => {
    setPending(null)
    try {
      sessionStorage.removeItem(key)
    } catch { /* A stale receipt can still be checked safely after reload. */ }
  }
  const open = () => {
    setShowConfirmation(true)
    setError('')
  }
  const execute = async () => {
    if (!showConfirmation || !connected || inFlight.current) return
    const checkOnly = !!pending
    const request: QueueCleanupRequest = pending || {
      operation: 'pending',
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
      throughQueueId: queue.result.reduce((max, id) => Math.max(max, id), 0),
      expiresAt: Date.now() + 15000,
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(request))
    } catch {
      setError('Permite el almacenamiento del navegador para confirmar el reinicio.')
      return
    }
    setPending(request)
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const response = await socket.timeout(10000).emitWithAck('action', { type: QUEUE_CLEANUP, payload: { ...request, checkOnly, confirmed: !checkOnly } })
      const currentUser = store.getState().user
      if (currentUser.roomId !== roomId || currentUser.userId !== userId) return
      if (response.error) {
        clearPending()
        setError(response.error)
        return
      }
      if (response.type !== QUEUE_CLEANUP + '_SUCCESS') throw new Error('Unrecognized acknowledgment')
      if (response.payload?.queue) dispatch(queuePush(response.payload.queue))
      if (!response.payload?.found) {
        clearPending()
        setError('No se registró la operación. Revisa el alcance y vuelve a confirmar si deseas continuar.')
        return
      }
      const result = response.payload.result as QueueCleanupResult
      if (result.requestId !== request.requestId || result.operation !== request.operation) throw new Error('Mismatched acknowledgment')
      clearPending()
      setShowConfirmation(false)
    } catch {
      setError('No se recibió la confirmación. Comprueba el resultado antes de repetir la operación.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <section className={styles.container} aria-label='Limpieza de la cola'>
      <div className={styles.actions}>
        <Button className={styles.trigger} variant='default' icon={pending ? 'CHECK' : 'REPLAY'} size={18} aria-label={pending ? 'Comprobar resultado' : 'Reiniciar cola'} disabled={!connected || queue.isLoading} onClick={open} />
      </div>
      {!connected && <p role='status'>Sin conexión. Espera a reconectar para reiniciar la cola.</p>}
      {connected && queue.isLoading && <p role='status'>Actualizando la cola…</p>}
      {showConfirmation && (
        <Modal title={pending ? 'Comprobar resultado' : '¿Reiniciar la cola?'} onClose={() => { if (!busy) setShowConfirmation(false) }}>
          <div className={styles.confirmation}>
            {busy
              ? <p role='status'>Esperando la confirmación del servidor…</p>
              : pending
                ? <p>Comprueba si se aplicó la operación antes de intentarlo de nuevo.</p>
                : <ResetDetails />}
            {error && <p role='alert' className={styles.error}>{error}</p>}
            {!connected && <p role='status'>Reconecta para continuar.</p>}
            <div className={styles.actions}>
              <button type='button' autoFocus ref={button => button?.setAttribute('autofocus', '')} className={styles.cancel} disabled={busy} onClick={() => setShowConfirmation(false)}>Cancelar</button>
              <Button variant={pending ? 'primary' : 'danger'} disabled={busy || !connected} onClick={() => void execute()}>{busy ? 'Procesando…' : pending ? 'Comprobar resultado' : 'Reiniciar cola'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

function ResetDetails () {
  const { data } = usePlaylists()
  const active = data?.playback.enabled && data.playlists.find(list => list.playlistId === data.playback.playlistId)
  return (
    <p>
      Se detendrá la canción actual y se quitarán todos los pedidos y el historial visible de esta sala.
      {' '}
      {active
        ? `La lista «${active.name}» volverá a empezar y se mezclará.`
        : data ? 'La cola quedará vacía.' : 'Si hay una lista activa, volverá a empezar y se mezclará.'}
    </p>
  )
}
