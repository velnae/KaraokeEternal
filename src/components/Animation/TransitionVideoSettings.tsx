import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import TransitionBackground, { type BackgroundPlaybackState } from 'components/TransitionBackground/TransitionBackground'
import type { TransitionVideo } from 'shared/transitionVideo'
import { useTransitionVideoSettings } from './useTransitionVideoSettings'
import { sameVideoAppearance } from './transitionVideoState'
import audioStyles from './AudioLibrary.css'
import styles from './TransitionVideoSettings.css'

const samples = {
  karaoke: { label: 'Karaoke', eyebrow: 'La próxima voz', title: 'Tu momento de brillar', detail: 'Valeria canta «Vivir mi vida»' },
  greeting: { label: 'Saludo', eyebrow: 'Un saludo para Lucía', title: '¡Feliz cumpleaños!', detail: 'De parte de tus amigos de la mesa 4. Esta canción es para ti.' },
  announcement: { label: 'Anuncio', eyebrow: 'Una noche para cantar juntos', title: 'La próxima canción es tuya', detail: 'Elige tu canción y prepárate para subir al escenario.' },
}
const stateLabels = { preparing: 'Preparando video', ready: 'Video disponible', failed: 'No se pudo preparar el video' }

export default function TransitionVideoSettings ({ roomId }: { roomId: number }) {
  const { state, dispatch, upload, save, change, reload, refresh, cancelUpload } = useTransitionVideoSettings(roomId)
  const { overview, draft, resource, operation } = state
  const [sample, setSample] = useState<keyof typeof samples>('karaoke')
  const [playRequest, setPlayRequest] = useState<string | null>(null)
  const [playback, setPlayback] = useState<BackgroundPlaybackState>('idle')
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [uploadName, setUploadName] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const uploadHelpId = useId()
  const playbackHelpId = useId()
  const onPlaybackStateChange = useCallback((next: BackgroundPlaybackState) => {
    setPlayback(next)
    if (['blocked', 'failed', 'paused', 'idle'].includes(next)) setPlayRequest(null)
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      setReducedMotion(preference.matches)
      if (preference.matches) setPlayRequest(null)
    }
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  const busy = operation !== 'idle'
  const editingLocked = busy || !!state.pendingSave
  const choices = [...(overview?.videos ?? [overview?.selected, overview?.candidate]), resource].filter((video, index, all): video is TransitionVideo => !!video && all.findIndex(candidate => candidate?.id === video.id) === index)
  const listed = (overview?.videos ?? [overview?.selected, overview?.candidate]).some(video => video?.id === resource?.id)
  const allActive = draft?.mode === 'all'
  const available = allActive || !draft?.videoId || (resource?.id === draft.videoId && resource.state !== 'failed')
  const ready = resource?.state === 'ready' && !!resource.videoUrl
  const resourceKey = resource ? `${resource.id}:${resource.checksum}` : null
  const playing = ready && resourceKey === playRequest
  const dirty = !!draft && !!overview && !sameVideoAppearance(draft, overview.settings)
  function saveReason () {
    if (!draft) return 'Cargando la configuración del fondo…'
    if (operation !== 'idle') return { uploading: 'Espere a que termine la carga.', recovering: 'Comprobando si el servidor recibió el video…', saving: 'Guardando el fondo…', reloading: 'Recargando la configuración…', updating: 'Actualizando el catálogo…' }[operation]
    if (state.connectionError) return 'Recupere la conexión para guardar. Los cambios locales se conservan.'
    if (state.conflict) return 'Recargue la configuración para resolver el cambio de versión.'
    if (!available) return 'Este video no está disponible. Seleccione otro video o quite la selección.'
    if (!allActive && draft.videoId && !ready) return 'Para guardar, espere a que el video esté disponible o elija otro archivo.'
    if (state.pendingSave) return 'El guardado está sin confirmar. Compruebe el estado o reintente el mismo guardado.'
    return dirty ? 'Hay cambios locales. Guarde para conservar la selección y el oscurecimiento.' : 'La configuración coincide con el fondo guardado.'
  }
  const canSave = !!draft && !busy && !state.connectionError && !state.conflict && available && (allActive || !draft.videoId || ready) && (dirty || !!state.pendingSave)
  function uploadReason () {
    if (!overview) return 'Cargando la disponibilidad del servidor…'
    if (state.connectionError) return 'Recupere la conexión para subir un archivo.'
    if (overview.capability.reason) return overview.capability.reason
    if (overview.capability.busy) return 'Hay un video en carga o preparación. Espere a que termine.'
    if (editingLocked) return 'Termine la operación actual antes de subir otro archivo.'
    return 'MP4 H.264 de 8 bits. Máximo 30 s, 1080p, 30 fps y 40 MiB; se recomienda 16:9.'
  }
  const canUpload = !!overview?.capability.available && !overview.capability.busy && !editingLocked && !state.connectionError
  function playbackMessage () {
    if (!ready) return 'Suba o seleccione un video disponible para reproducir la vista previa.'
    if (playback === 'failed') return 'No se pudo reproducir el video. Se muestra el fondo de respaldo; puede reintentar la vista previa.'
    if (playback === 'blocked') return 'El navegador detuvo la reproducción. Pulse Reproducir vista previa para reintentar.'
    if (playback === 'buffering' || playback === 'loading') return 'Cargando el video. El texto permanece visible sobre el fondo de respaldo.'
    return reducedMotion ? 'Movimiento reducido: imagen fija por defecto. Puede reproducir el video con el control local.' : 'La vista previa se reproduce solo en este dispositivo.'
  }
  function preparationLabel () {
    if (operation === 'uploading') return `Subiendo video${state.progress === null ? '…' : `: ${state.progress} %`}`
    if (operation === 'recovering') return 'Comprobando la carga…'
    if (!listed && resource?.state === 'failed') return 'El video ya no está disponible'
    return resource ? stateLabels[resource.state] : 'Suba un MP4 para comenzar.'
  }
  const fileSize = resource?.size && resource.size < 1024 * 1024 ? `${Math.ceil(resource.size / 1024)} KiB` : `${((resource?.size ?? 0) / 1024 / 1024).toFixed(1)} MiB`
  const text = samples[sample]
  const select = (video: TransitionVideo | null) => {
    setPlayRequest(null)
    dispatch({ type: 'select', resource: video })
  }

  return (
    <section className={styles.panel} aria-label='Fondo de transición'>
      <header className={styles.heading}>
        <h2>Fondo de transición</h2>
        <p>Conserve sus videos y elija un fondo fijo o alterne todos los activos en esta sala.</p>
      </header>
      <label className={styles.field}>
        Modo de fondos
        <select
          value={allActive ? 'all' : draft?.videoId ? 'single' : 'none'}
          disabled={!draft || editingLocked}
          onChange={event => dispatch({ type: 'mode', mode: event.target.value as 'single' | 'all' | 'none' })}
        >
          <option value='none'>Sin video</option>
          <option value='single'>Un video fijo</option>
          <option value='all'>Todos los activos</option>
        </select>
      </label>
      <p className={styles.help}>
        {allActive
          ? `${choices.filter(video => video.active && video.state === 'ready').length} videos activos. Se alternan una vez por transición; si no hay disponibles se usa el fondo de respaldo.`
          : 'Elija un video y guarde para usarlo como fondo fijo. Guardar también activa el video elegido.'}
      </p>
      <div className={styles.previewLabel}>
        <strong>Vista previa local</strong>
        <span>No se transmite al reproductor</span>
      </div>
      <TransitionBackground resource={resource} dimOpacity={draft?.dimOpacity ?? 0.55} playing={playing} onPlaybackStateChange={onPlaybackStateChange}>
        <div className={styles.sample} data-sample={sample}>
          <span>{text.eyebrow}</span>
          <h3>{text.title}</h3>
          <p>{text.detail}</p>
        </div>
      </TransitionBackground>
      <div className={styles.previewControls}>
        <div className={styles.samples} role='group' aria-label='Texto de ejemplo'>
          {(Object.keys(samples) as (keyof typeof samples)[]).map(key => (
            <Button key={key} className={styles.sampleButton} aria-pressed={sample === key} onClick={() => setSample(key)}>{samples[key].label}</Button>
          ))}
        </div>
        <Button className={audioStyles.secondary} disabled={!ready} aria-describedby={playbackHelpId} onClick={() => setPlayRequest(playing ? null : resourceKey)}>
          {playing ? 'Pausar vista previa' : 'Reproducir vista previa'}
        </Button>
      </div>
      <p id={playbackHelpId} className={styles.help} role='status'>{playbackMessage()}</p>

      {!overview && !state.connectionError && <p role='status'>Cargando la configuración del fondo…</p>}
      {state.connectionError && (
        <div className={styles.notice} role='alert'>
          <p>{`${state.connectionError} Los cambios locales se conservan.`}</p>
          <div className={styles.actions}>
            <Button className={audioStyles.secondary} onClick={refresh}>Reintentar conexión</Button>
            <Link to='/account'>Volver a ingresar</Link>
          </div>
        </div>
      )}
      {state.conflict && (
        <div className={styles.notice} role='alert'>
          <p>El fondo cambió en otra sesión. Recargar descartará los cambios locales y mostrará la configuración guardada.</p>
          <Button
            className={audioStyles.secondary}
            disabled={busy}
            onClick={() => {
              setPlayRequest(null)
              void reload()
            }}
          >
            Recargar configuración
          </Button>
        </div>
      )}

      <div className={styles.fileSection}>
        <div className={styles.fileInfo}>
          <strong>{operation === 'uploading' || operation === 'recovering' ? uploadName : resource?.title || 'Sin video seleccionado'}</strong>
          <span role='status' data-state={resource?.state}>{preparationLabel()}</span>
          {resource?.state === 'ready' && <small>{`${(resource.durationMs! / 1000).toFixed(1)} s · ${resource.width} × ${resource.height} · ${fileSize}`}</small>}
        </div>
        <div className={styles.actions}>
          <input
            ref={file}
            type='file'
            accept='.mp4,video/mp4'
            hidden
            aria-label='Archivo de video'
            onChange={(event) => {
              const selected = event.target.files?.[0]
              event.target.value = ''
              if (selected) {
                setPlayRequest(null)
                setUploadName(selected.name)
                void upload(selected)
              }
            }}
          />
          <Button className={audioStyles.secondary} disabled={!canUpload} aria-describedby={uploadHelpId} onClick={() => file.current?.click()}>
            Agregar video
          </Button>
          {operation === 'uploading' && <Button className={audioStyles.secondary} onClick={cancelUpload}>Cancelar carga</Button>}
          {state.retryUpload && !busy && <Button className={audioStyles.secondary} onClick={() => void upload()}>Reintentar carga</Button>}
        </div>
      </div>
      {operation === 'uploading' && <progress className={styles.progress} aria-label='Progreso de carga' max={100} value={state.progress ?? undefined} />}
      <p id={uploadHelpId} className={styles.help}>{uploadReason()}</p>
      <p className={styles.help}>El video se guarda sin sonido. Las voces y el ambiente se añaden por separado.</p>
      <p className={styles.help}>Los videos nuevos quedan inactivos hasta que los active o los guarde como fondo fijo.</p>
      {resource?.state === 'failed' && <p className={styles.notice} role='alert'>{`${resource.reason} Elija otro archivo o seleccione el fondo guardado.`}</p>}

      <ul className={styles.catalog} aria-label='Videos de transición'>
        {(overview?.videos ?? []).map((video) => {
          const fixed = overview?.settings.mode !== 'all' && overview?.settings.videoId === video.id
          return (
            <li key={video.id} className={styles.catalogItem}>
              {video.posterUrl && <img src={new URL(video.posterUrl, document.baseURI).href} alt='' loading='lazy' />}
              <div className={styles.fileInfo}>
                <strong>{video.title}</strong>
                <span>{video.state === 'ready' ? video.active ? 'Activo' : 'Inactivo' : stateLabels[video.state]}</span>
                {video.durationMs && <small>{`${(video.durationMs / 1000).toFixed(1)} s · ${((video.size ?? 0) / 1024 / 1024).toFixed(1)} MiB`}</small>}
                {fixed && <small>Fondo fijo. Quite la selección y guarde antes de desactivarlo o eliminarlo.</small>}
                {video.reason && <small>{video.reason}</small>}
              </div>
              <div className={styles.actions}>
                <Button className={audioStyles.secondary} disabled={editingLocked} onClick={() => select(video)}>Vista previa</Button>
                <Button
                  className={audioStyles.secondary}
                  disabled={editingLocked || video.state !== 'ready' || fixed}
                  onClick={() => void change(video.id, !video.active)}
                >
                  {video.active ? 'Desactivar' : 'Activar'}
                </Button>
                <Button
                  className={audioStyles.secondary}
                  disabled={editingLocked || video.state === 'preparing' || fixed}
                  onClick={() => { if (window.confirm(`¿Eliminar «${video.title}» del catálogo?`)) void change(video.id, 'delete') }}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {overview && !overview.videos?.length && <p className={styles.help}>Todavía no hay videos. Use Agregar video para guardar el primero.</p>}

      <div className={styles.fields}>
        <label className={styles.field}>
          Video para la vista previa
          <select value={resource?.id ?? ''} disabled={!draft || editingLocked} onChange={event => select(choices.find(video => video.id === event.target.value) ?? null)}>
            <option value=''>Sin fondo de video</option>
            {choices.map(video => <option key={video.id} value={video.id}>{`${video.title}${video.state === 'failed' ? ' — no disponible' : overview?.selected?.id === video.id ? ' — fijo' : video.active ? ' — activo' : ' — inactivo'}`}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.sliderLabel}>
            Oscurecimiento
            <output>{`${Math.round((draft?.dimOpacity ?? 0.55) * 100)} %`}</output>
          </span>
          <input
            type='range'
            aria-label='Oscurecimiento'
            aria-valuetext={`${Math.round((draft?.dimOpacity ?? 0.55) * 100)} %`}
            min={0}
            max={85}
            step={1}
            value={Math.round((draft?.dimOpacity ?? 0.55) * 100)}
            disabled={!draft || editingLocked}
            onChange={event => dispatch({ type: 'opacity', value: Number(event.target.value) / 100 })}
          />
        </label>
      </div>
      {state.error && <p className={styles.notice} role='alert'>{state.error}</p>}
      <footer className={styles.footer}>
        <div className={styles.actions}>
          <Button variant='primary' disabled={!canSave} aria-describedby={helpId} onClick={() => void save()}>{operation === 'saving' ? 'Guardando…' : state.pendingSave ? 'Reintentar guardado' : 'Guardar fondo'}</Button>
          <Button className={audioStyles.secondary} disabled={!draft?.videoId || editingLocked} aria-describedby={helpId} onClick={() => select(null)}>Quitar selección</Button>
          {state.pendingSave && !busy && <Button className={audioStyles.secondary} onClick={refresh}>Comprobar guardado</Button>}
        </div>
        <p id={helpId} className={styles.help}>{saveReason()}</p>
        {state.notice && <p className={styles.saved} role='status'>{state.notice}</p>}
        <p className={styles.help}>Guardar aplica este fondo a las próximas transiciones del reproductor. Esta vista previa sigue siendo local.</p>
      </footer>
    </section>
  )
}
