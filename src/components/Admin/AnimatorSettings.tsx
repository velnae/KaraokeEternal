import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import AnimationPanel from 'components/Animation/AnimationPanel'
import CatalogProductionPanel from 'components/Animation/CatalogProductionPanel'
import AnimationQuickControls from 'components/Animation/AnimationQuickControls'
import OperationControls from 'components/Animation/OperationControls'
import GreetingVoiceSettings from 'components/Animation/GreetingVoiceSettings'
import KaraokeCallPilot from 'components/Animation/KaraokeCallPilot'
import TransitionVideoSettings from 'components/Animation/TransitionVideoSettings'
import { animationRequest } from 'lib/animationApi'
import { ANIMATION_CONTROL } from 'shared/animation'
import type { ProviderCapabilities } from 'shared/audioCatalog'
import HttpApi from 'lib/HttpApi'
import styles from './Admin.css'
import audioStyles from 'components/Animation/AudioLibrary.css'

function ProviderSettings () {
  const [providers, setProviders] = useState<ProviderCapabilities[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void new HttpApi('animation/').get<{ providers: ProviderCapabilities[] }>('providers').then(result => setProviders(result.providers)).catch(error => setError(error.message))
  }, [])
  const check = async (provider: ProviderCapabilities) => {
    setBusy(true)
    setError('')
    try {
      await new HttpApi('animation/').post('production/check', { body: { providerId: provider.id, kind: provider.kinds[0] } })
      setMessage(`${provider.name}: conexión disponible`)
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <section aria-label='Proveedores de audio'>
      <h3>Proveedores de audio</h3>
      {providers.map(provider => (
        <div key={provider.id} className={audioStyles.toolbar}>
          <span>{provider.name}</span>
          {provider.configured
            ? <Button className={audioStyles.secondary} disabled={busy} onClick={() => void check(provider)}>Comprobar conexión</Button>
            : (
                <p className={audioStyles.help}>
                  Configure las credenciales de
                  {provider.name}
                  {' '}
                  en el servidor.
                </p>
              )}
        </div>
      ))}
      {message && <p role='status'>{message}</p>}
      {error && <p role='alert' className={audioStyles.notice}>{error}</p>}
    </section>
  )
}

export default function AnimatorSettings () {
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'calls' ? 'calls' : params.get('view') === 'background' ? 'background' : params.get('view') === 'greeting-voice' ? 'greeting-voice' : params.get('view') === 'audio' ? 'audio' : 'control'
  const liveView = view === 'control' || view === 'audio'
  const settings = params.get('panel') === 'settings' || params.get('view') === 'connection'
  const roomId = useAppSelector(state => state.user.roomId)
  const { snapshot, connected } = useAppSelector(state => state.animation)
  const current = snapshot?.roomId === roomId ? snapshot : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await animationRequest(ANIMATION_CONTROL, { controlVersion: current?.controlVersion, enabled: !current?.prefs.enabled })
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('panel')
    if (next.get('view') === 'connection') next.set('view', 'control')
    setParams(next, { replace: true })
  }
  return (
    <>
      {liveView && (
        <div className={audioStyles.headerControls}>
          <label className={audioStyles.check}>
            <input type='checkbox' role='switch' aria-label='Activado' checked={!!current?.prefs.enabled} disabled={!current || !connected || busy} onChange={() => void toggle()} />
            {current?.prefs.enabled ? 'Activado' : 'Desactivado'}
          </label>
          <div className={audioStyles.actions}>
            {view === 'audio' && <AnimationQuickControls showLink={false} />}
            <Button
              className={audioStyles.secondary}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('panel', 'settings')
                setParams(next)
              }}
            >
              Ajustes
            </Button>
          </div>
        </div>
      )}
      {liveView && (!connected || !current) && <p role='status' className={audioStyles.notice}>Conectando con la sala… Los controles se habilitarán al recuperar la conexión.</p>}
      {liveView && error && <p role='alert' className={audioStyles.notice}>{error}</p>}
      <nav className={styles.tabs} aria-label='Ajustes del animador'>
        <Link to='?view=control' aria-current={view === 'control' ? 'page' : undefined}>Control</Link>
        <Link to='?view=audio' aria-current={view === 'audio' ? 'page' : undefined}>Audios</Link>
        <Link to='?view=calls' aria-current={view === 'calls' ? 'page' : undefined}>Llamados</Link>
        <Link to='?view=greeting-voice' aria-current={view === 'greeting-voice' ? 'page' : undefined}>Voz de saludos</Link>
        <Link to='?view=background' aria-current={view === 'background' ? 'page' : undefined}>Fondo</Link>
      </nav>
      <div hidden={view !== 'control'}><AnimationPanel /></div>
      <CatalogProductionPanel key={roomId} visible={view === 'audio'} />
      {view === 'calls' && typeof roomId === 'number' && <KaraokeCallPilot key={`calls-${roomId}`} roomId={roomId} />}
      {view === 'greeting-voice' && <GreetingVoiceSettings key={`greeting-voice-${roomId}`} />}
      {view === 'background' && (typeof roomId === 'number' ? <TransitionVideoSettings key={`background-${roomId}`} roomId={roomId} /> : <p role='status'>Ingrese a una sala para configurar su fondo.</p>)}
      {view === 'background' && typeof roomId === 'number' && <OperationControls key={`ambience-${roomId}`} ambienceOnly />}
      {liveView && settings && (
        <Modal className={audioStyles.dialog} title='Ajustes del animador' onClose={close}>
          <OperationControls settings />
          <ProviderSettings />
          <div className={audioStyles.actions}><Button className={audioStyles.secondary} onClick={close}>Cerrar ajustes</Button></div>
        </Modal>
      )}
    </>
  )
}
