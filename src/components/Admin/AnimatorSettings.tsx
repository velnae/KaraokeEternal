import React, { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import AnimationPanel from 'components/Animation/AnimationPanel'
import CatalogProductionPanel from 'components/Animation/CatalogProductionPanel'
import AnimationQuickControls from 'components/Animation/AnimationQuickControls'
import OperationControls from 'components/Animation/OperationControls'
import GreetingRoomSettings from 'components/Animation/GreetingRoomSettings'
import KaraokeCallPilot from 'components/Animation/KaraokeCallPilot'
import NameVoicePanel from 'components/Animation/NameVoicePanel'
import TransitionVideoSettings from 'components/Animation/TransitionVideoSettings'
import { animationRequest } from 'lib/animationApi'
import { ANIMATION_CONTROL } from 'shared/animation'
import styles from './Admin.css'
import audioStyles from 'components/Animation/AudioLibrary.css'

export default function AnimatorSettings () {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'names' ? 'names' : params.get('view') === 'calls' ? 'calls' : params.get('view') === 'background' ? 'background' : params.get('view') === 'greeting-voice' ? 'greeting-voice' : params.get('view') === 'audio' ? 'audio' : 'control'
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
  if (isAdmin && params.get('view') === 'connection') return <Navigate to='/admin/settings/audio-providers' replace />
  if (!isAdmin) return (
    <>
      <Button variant='default' disabled={!current || !connected || busy} onClick={() => void toggle()}>{current?.prefs.enabled ? 'Desactivar animador' : 'Activar animador'}</Button>
      {(!connected || !current) && <p role='status'>Conectando con la sala…</p>}
      {error && <p role='alert'>{error}</p>}
      <AnimationPanel />
    </>
  )
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
        <Link to='?view=names' aria-current={view === 'names' ? 'page' : undefined}>Nombres</Link>
        <Link to='?view=greeting-voice' aria-current={view === 'greeting-voice' ? 'page' : undefined}>Saludos</Link>
        <Link to='?view=background' aria-current={view === 'background' ? 'page' : undefined}>Fondo</Link>
      </nav>
      <div hidden={view !== 'control'}><AnimationPanel /></div>
      <CatalogProductionPanel key={roomId} visible={view === 'audio'} />
      {view === 'calls' && typeof roomId === 'number' && <KaraokeCallPilot key={`calls-${roomId}`} roomId={roomId} />}
      {view === 'names' && <NameVoicePanel />}
      {view === 'greeting-voice' && <GreetingRoomSettings key={`greeting-voice-${roomId}`} />}
      {view === 'background' && (typeof roomId === 'number' ? <TransitionVideoSettings key={`background-${roomId}`} roomId={roomId} /> : <p role='status'>Ingrese a una sala para configurar su fondo.</p>)}
      {view === 'background' && typeof roomId === 'number' && <OperationControls key={`ambience-${roomId}`} ambienceOnly />}
      {liveView && settings && (
        <Modal className={audioStyles.dialog} title='Ajustes del animador' onClose={close}>
          <OperationControls settings />
          <Link to='/admin/settings/audio-providers'>Proveedores de audio</Link>
          <div className={audioStyles.actions}><Button className={audioStyles.secondary} onClick={close}>Cerrar ajustes</Button></div>
        </Modal>
      )}
    </>
  )
}
