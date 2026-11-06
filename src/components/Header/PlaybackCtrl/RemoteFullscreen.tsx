import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { useAppSelector } from 'store/hooks'
import socket from 'lib/socket'
import { animationTime } from 'lib/animationApi'
import { PLAYER_REQ_FULLSCREEN } from 'shared/actionTypes'
import { FULLSCREEN_REQUEST_MS, fullscreenMessages, fullscreenResult, type FullscreenResult } from 'shared/playerFullscreen'
import styles from './RemoteFullscreen.css'

export default function RemoteFullscreen ({ available }: { available: boolean }) {
  const roomId = useAppSelector(state => state.user.roomId)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FullscreenResult | null>(null)
  const [help, setHelp] = useState(false)
  const generation = useRef(0)
  const feedbackId = useId()
  useEffect(() => {
    const requests = generation
    requests.current++
    setBusy(false)
    setResult(null)
    return () => {
      requests.current++
    }
  }, [roomId])

  const request = async () => {
    if (busy || !available) return
    if (!socket.connected) {
      setResult({ status: 'disconnected' })
      return
    }
    const version = ++generation.current
    setBusy(true)
    setResult(null)
    try {
      const reply = await socket.timeout(FULLSCREEN_REQUEST_MS + 2000).emitWithAck('action', {
        type: PLAYER_REQ_FULLSCREEN,
        payload: { expiresAt: animationTime() + FULLSCREEN_REQUEST_MS },
      })
      if (generation.current === version) setResult(reply?.error ? { status: 'forbidden' } : fullscreenResult(reply?.payload) ?? { status: 'rejected' })
    } catch {
      if (generation.current === version) setResult({ status: socket.connected ? 'timeout' : 'disconnected' })
    } finally {
      if (generation.current === version) setBusy(false)
    }
  }
  const origin = result?.origin ?? window.location.origin
  const policy = JSON.stringify({ AutomaticFullscreenAllowedForUrls: [origin] }, null, 2)
  const registry = `Windows Registry Editor Version 5.00\n\n[HKEY_CURRENT_USER\\Software\\Policies\\Google\\Chrome\\AutomaticFullscreenAllowedForUrls]\n"1"=${JSON.stringify(origin)}`

  return (
    <div className={styles.control} aria-busy={busy}>
      <div className={styles.actions}>
        <Button className={styles.request} icon='FULLSCREEN' disabled={!available || busy} onClick={() => void request()} aria-label='Pantalla completa del reproductor (beta)' aria-describedby={!available || busy || result ? feedbackId : undefined}>
          {busy ? 'Solicitando…' : 'Pantalla completa'}
          <span className={styles.beta}>Beta</span>
        </Button>
        <Button className={styles.help} onClick={() => setHelp(true)} aria-label='Ver pasos para fullscreen remoto'>Ver pasos</Button>
      </div>
      {(!available || busy || result) && (
        <p id={feedbackId} className={styles.feedback} role='status' data-result={result?.status}>
          {!available ? 'Abre el reproductor para continuar.' : busy ? 'Esperando confirmación del reproductor…' : result && fullscreenMessages[result.status]}
        </p>
      )}
      {help && (
        <Modal title='Pantalla completa remota (beta)' onClose={() => setHelp(false)} scrollable className={styles.instructions}>
          <p>Configura el permiso en el equipo y navegador del reproductor, no en el servidor. Usa Chrome 128 o posterior.</p>
          <ol>
            <li>
              {'Autoriza este origen con la política '}
              <code>AutomaticFullscreenAllowedForUrls</code>
              . Debe coincidir con la dirección del player.
            </li>
            <li>
              {'Abre '}
              <code>chrome://policy</code>
              {' en ese Chrome, recarga las políticas y comprueba que aparezca correctamente.'}
            </li>
            <li>Da Play en la pestaña del reproductor, sepárala en otra ventana y muévela al monitor elegido.</li>
            <li>Desde admin, pulsa «Pantalla completa». El player confirmará el resultado.</li>
          </ol>
          <p>
            {'Origen a autorizar: '}
            <strong>{origin}</strong>
          </p>
          <details>
            <summary>Windows · Google Chrome</summary>
            <p>
              {'Guarda este texto en un archivo '}
              <code>.reg</code>
              {' e impórtalo con el usuario que ejecuta Chrome. Si ya existe una lista, añade el origen conservando las entradas anteriores.'}
            </p>
            <pre>{registry}</pre>
          </details>
          <details>
            <summary>Linux · Chrome o Chromium</summary>
            <p>
              {'Guarda este JSON como '}
              <code>karaoke-fullscreen.json</code>
              {' en la carpeta de políticas administradas. En Google Chrome: '}
              <code>/etc/opt/chrome/policies/managed/</code>
              {'. En Chromium: '}
              <code>/etc/chromium/policies/managed/</code>
              .
            </p>
            <pre>{policy}</pre>
            <p>Se necesitan permisos de administrador del equipo. Si la política ya está definida, añade el origen a la lista existente.</p>
          </details>
          <p>El permiso no se concede desde este botón ni mediante el primer Play. Si no puedes habilitarlo, usa Ctrl+Alt+K desde los controles del karaoke.</p>
        </Modal>
      )}
    </div>
  )
}
