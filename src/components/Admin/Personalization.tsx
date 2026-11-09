import React, { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchPrefs } from 'store/modules/prefs'
import Button from 'components/Button/Button'
import BrandingPrefs from 'routes/Account/components/Prefs/BrandingPrefs/BrandingPrefs'
import { DISPLAY_CORNERS, displayLimits, type PlayerDisplaySettings } from 'shared/playerDisplay'
import type { TransitionVideoOverview } from 'shared/transitionVideo'
import HttpApi from 'lib/HttpApi'
import styles from './Personalization.css'

function LogoAppearance ({ current }: { current: PlayerDisplaySettings['logo'] }) {
  const [logo, setLogo] = useState({ enabled: current.enabled, position: current.position, scale: current.scale, opacity: current.opacity })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const previous = useRef(current)
  useEffect(() => {
    const prior = previous.current
    setLogo(draft => (Object.keys(draft) as (keyof typeof draft)[]).every(key => draft[key] === prior[key])
      ? { enabled: current.enabled, position: current.position, scale: current.scale, opacity: current.opacity }
      : draft)
    previous.current = current
  }, [current])
  const dispatch = useAppDispatch()
  const dirty = (Object.keys(logo) as (keyof typeof logo)[]).some(key => current[key] !== logo[key])
  const positions = ['Arriba a la izquierda', 'Arriba a la derecha', 'Abajo a la izquierda', 'Abajo a la derecha']
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await new HttpApi('prefs').put('/player-display', { body: { logo } })
      setSaved(true)
      await dispatch(fetchPrefs()).unwrap()
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <form className={styles.section} onSubmit={save}>
      <h2>Logo en pantalla</h2>
      <fieldset disabled={busy}>
        <label className={styles.check}>
          <input type='checkbox' checked={logo.enabled} onChange={event => setLogo({ ...logo, enabled: event.target.checked })} />
          Mostrar logo
        </label>
        <label>
          Posición
          <select aria-label='Posición' value={logo.position} onChange={event => setLogo({ ...logo, position: event.target.value as typeof logo.position })}>{DISPLAY_CORNERS.map((value, index) => <option key={value} value={value}>{positions[index]}</option>)}</select>
        </label>
        {(['scale', 'opacity'] as const).map(key => (
          <label key={key}>
            {key === 'scale' ? 'Tamaño del logo' : 'Opacidad del logo'}
            <output>{`${logo[key]}%`}</output>
            <input type='range' aria-label={key === 'scale' ? 'Tamaño del logo' : 'Opacidad del logo'} min={displayLimits.logo[key][0]} max={displayLimits.logo[key][1]} step={displayLimits.logo[key][2]} value={logo[key]} onChange={event => setLogo({ ...logo, [key]: Number(event.target.value) })} />
          </label>
        ))}
      </fieldset>
      {error && <p role='alert'>{error}</p>}
      {saved && <p role='status'>Logo guardado.</p>}
      {dirty && <Button type='submit' variant='primary' disabled={busy}>{busy ? 'Guardando…' : 'Guardar logo en pantalla'}</Button>}
    </form>
  )
}

function BackgroundSelection () {
  const [overview, setOverview] = useState<TransitionVideoOverview | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const api = new HttpApi('animation/background')
  const load = async () => {
    setError('')
    try {
      const value = await api.get<TransitionVideoOverview>('')
      setOverview(value)
      setSelected(value.settings.videoId ?? '')
    } catch (error) { setError((error as Error).message) }
  }
  useEffect(() => {
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const videos = overview?.videos?.filter(video => video.active && video.state === 'ready') ?? []
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!overview) return
    setBusy(true)
    setError('')
    try {
      const value = await api.put<TransitionVideoOverview>('', { body: { videoId: selected || null, revision: overview.settings.revision } })
      setOverview(value)
      setSaved(true)
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <form className={styles.section} onSubmit={save}>
      <h2>Fondo entre canciones</h2>
      {!overview && !error && <p role='status'>Cargando fondos…</p>}
      {overview && (
        <label>
          Fondo
          <select
            disabled={busy}
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value)
              setSaved(false)
            }}
          >
            <option value=''>Sin fondo fijo</option>
            {selected && !videos.some(video => video.id === selected) && <option value={selected} disabled>Fondo no disponible</option>}
            {videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)}
          </select>
        </label>
      )}
      {overview && videos.length === 0 && <p role='status'>No hay fondos habilitados. Solicite uno al administrador.</p>}
      {error && (
        <div role='alert'>
          <p>{error}</p>
          <Button onClick={() => void load()}>Recargar fondos</Button>
        </div>
      )}
      {saved && <p role='status'>Fondo guardado.</p>}
      {overview && selected !== (overview.settings.videoId ?? '') && <Button type='submit' variant='primary' disabled={busy}>{busy ? 'Guardando…' : 'Guardar fondo'}</Button>}
    </form>
  )
}

export default function Personalization () {
  const display = useAppSelector(state => state.prefs.playerDisplay)
  const roomId = useAppSelector(state => state.user.roomId)
  return (
    <div className={styles.container}>
      <BrandingPrefs />
      <LogoAppearance current={display.logo} />
      {roomId ? <BackgroundSelection key={roomId} /> : <p role='status'>Seleccione una sala al iniciar sesión para cambiar el fondo.</p>}
    </div>
  )
}
