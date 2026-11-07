import React, { useRef, useState } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { useConnection } from 'routes/Participant/useConnection'
import { queuePush } from '../../modules/queue'
import { QUEUE_CLEANUP } from 'shared/actionTypes'
import { isQueueHistoryHidden, type QueueCleanupOperation, type QueueCleanupRequest, type QueueCleanupResult } from 'shared/queueCleanup'
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
  const { queueId, isAtQueueEnd } = useAppSelector(state => state.status)
  const connected = useConnection()
  const dispatch = useAppDispatch()
  const key = `queue-cleanup:${roomId}:${userId}`
  const [pending, setPending] = useState<QueueCleanupRequest | null>(() => restore(key))
  const [operation, setOperation] = useState<QueueCleanupOperation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inFlight = useRef(false)
  const eligible = Object.values(queue.entities).filter(item => item.isOptimistic !== true && (item.queueId !== queueId || isAtQueueEnd))
  const history = eligible.filter(item => item.isOptimistic !== true && !isQueueHistoryHidden(item) && ['PLAYED', 'FAILED', 'REJECTED'].includes(item.status)).length
  const clearPending = () => {
    setPending(null)
    try {
      sessionStorage.removeItem(key)
    } catch { /* A stale receipt can still be checked safely after reload. */ }
  }
  const open = (choice: QueueCleanupOperation) => {
    setOperation(pending?.operation || choice)
    setError('')
    setNotice('')
  }
  const execute = async () => {
    if (!operation || !connected || inFlight.current) return
    const checkOnly = !!pending
    const request: QueueCleanupRequest = pending || {
      operation,
      requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
      throughQueueId: queue.result.reduce((max, id) => Math.max(max, id), 0),
      expiresAt: Date.now() + 15000,
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(request))
    } catch {
      setError('Permite el almacenamiento del navegador para confirmar la limpieza.')
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
      setOperation(null)
      setNotice(result.operation === 'pending'
        ? `Cola vaciada completamente. Reproducción detenida.${result.houseStopped ? ' Se desactivó la lista de la casa.' : ''}`
        : `${result.changedCount === 1 ? 'Se retiró 1 canción' : `Se retiraron ${result.changedCount} canciones`} del historial visible.`)
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
        <Button variant='default' disabled={!connected || queue.isLoading} onClick={() => open('pending')}>Vaciar cola</Button>
        <Button variant='default' disabled={!connected || queue.isLoading} onClick={() => open('history')}>Limpiar historial</Button>
      </div>
      {!connected && <p role='status'>Sin conexión. Espera a reconectar para limpiar la cola.</p>}
      {connected && queue.isLoading && <p role='status'>Actualizando la cola…</p>}
      {notice && <p role='status'>{notice}</p>}
      {pending && !operation && (
        <p role='status'>
          Hay una limpieza sin confirmar.
          <Button onClick={() => open(pending.operation)}>Comprobar resultado</Button>
        </p>
      )}
      {operation && (
        <Modal title={operation === 'pending' ? '¿Vaciar completamente la cola?' : 'Limpiar historial'} onClose={() => { if (!busy) setOperation(null) }}>
          <div className={styles.confirmation}>
            {busy
              ? <p role='status'>Esperando la confirmación del servidor…</p>
              : pending
                ? <p>Esta operación quedó sin confirmar. Comprobar consulta su resultado sin ejecutar otra limpieza.</p>
                : operation === 'pending'
                  ? (
                      <>
                        <p>Se detendrá la reproducción y se quitarán todas las canciones de esta cola, incluido el historial visible. Tus listas guardadas se conservarán.</p>
                        <p>También se retirará la canción actual si está pausada y se desactivará la reposición automática de la casa. Los pedidos nuevos podrán seguir entrando después del vaciado.</p>
                      </>
                    )
                  : (
                      <>
                        <p>{history === 1 ? '1 canción finalizada en el historial visible.' : `${history} canciones finalizadas en el historial visible.`}</p>
                        <p>Se retirarán de la vista las canciones reproducidas, fallidas y rechazadas de todas las mesas. Los datos internos se conservan para evitar duplicados.</p>
                        <p>La canción actual, los pedidos pendientes y las listas guardadas se conservan.</p>
                      </>
                    )}
            {error && <p role='alert' className={styles.error}>{error}</p>}
            {!connected && <p role='status'>Reconecta para continuar.</p>}
            <div className={styles.actions}>
              <button type='button' autoFocus ref={button => button?.setAttribute('autofocus', '')} className={styles.cancel} disabled={busy} onClick={() => setOperation(null)}>Cancelar</button>
              <Button variant={pending ? 'primary' : 'danger'} disabled={busy || !connected} onClick={() => void execute()}>{busy ? 'Procesando…' : pending ? 'Comprobar resultado' : operation === 'pending' ? 'Vaciar cola' : 'Limpiar historial'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
