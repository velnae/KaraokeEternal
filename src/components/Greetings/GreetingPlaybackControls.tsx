import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import { fetchAnimationClips } from 'lib/animationApi'
import type { AnimationClip } from 'shared/animation'
import type { GreetingPlaybackPrefs, GreetingSnapshot } from 'shared/greetings'
import styles from 'components/Animation/LocalTtsSettings.css'

export default function GreetingPlaybackControls ({ snapshot, busy, save }: {
  snapshot: GreetingSnapshot | null
  busy: boolean
  save: (settings: GreetingPlaybackPrefs, version: number) => void
}) {
  const roomId = useAppSelector(state => state.user.roomId)
  const catalogVersion = useAppSelector(state => state.animation.snapshot?.catalogVersion)
  const [clips, setClips] = useState<AnimationClip[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    void fetchAnimationClips().then((result): void => {
      if (alive) {
        setClips(result.filter(clip => clip.approvedForAuto && (!clip.validUntil || clip.validUntil > Date.now())))
        setError('')
      }
      return undefined
    }).catch((error) => { if (alive) setError(error.message) })
    return () => {
      alive = false
    }
  }, [roomId, catalogVersion, retry])
  const change = (patch: Partial<GreetingPlaybackPrefs>) => {
    if (snapshot) save({ ...snapshot.playback, ...patch }, snapshot.playbackVersion)
  }
  const voices = clips.filter(clip => (clip.kind ?? 'voice') === 'voice')
  const selected = voices.find(clip => clip.id === snapshot?.playback.introClipId)
  return (
    <div className={styles.preparation}>
      <h3>Lectura en la sala</h3>
      <label className={styles.check}>
        <input type='checkbox' checked={snapshot?.playback.enabled ?? false} disabled={!snapshot || busy} onChange={event => change({ enabled: event.target.checked })} aria-describedby='greeting-playback-help' />
        Leer saludos en voz alta
      </label>
      <p id='greeting-playback-help' className={styles.hint}>{!snapshot ? 'Conectando con la sala para cargar estos controles.' : 'Activar la lectura también activa la preparación. Cada saludo se presenta antes de su canción. Si el audio no está listo, continúa en pantalla.'}</p>
      <label className={styles.field}>
        Presentación del saludo
        <select aria-label='Presentación del saludo' value={snapshot?.playback.introClipId ?? ''} disabled={!snapshot || busy} onChange={event => change({ introClipId: event.target.value || null })}>
          <option value=''>Sin presentación</option>
          {snapshot?.playback.introClipId && !selected && <option value={snapshot.playback.introClipId}>Presentación no disponible</option>}
          {voices.map(clip => <option key={clip.id} value={clip.id}>{`${clip.title} (${(clip.durationMs / 1000).toFixed(1)} s)`}</option>)}
        </select>
      </label>
      <p className={styles.hint}>{selected?.displayText || 'Seleccione una presentación genérica del catálogo. El nombre y la mesa de quien canta se muestran en pantalla.'}</p>
      <p className={styles.hint}>La presentación elegida se reserva para los saludos y no se incluye en los anuncios automáticos generales.</p>
      <label className={styles.check}>
        <input type='checkbox' checked={snapshot?.playback.ambienceEnabled ?? true} disabled={!snapshot || busy} onChange={event => change({ ambienceEnabled: event.target.checked })} />
        Acompañar la lectura con ambiente suave
      </label>
      <p className={styles.hint}>{clips.some(clip => clip.kind === 'ambience') ? 'Se utiliza un ambiente disponible del perfil de la sala y se desvanece antes de la canción. La transición completa tiene un máximo de 25 segundos.' : 'No hay ambientes disponibles. Puede agregar uno en Audios; la voz también funciona sin fondo.'}</p>
      <p className={styles.hint}>La lectura usa el volumen de voz del animador y puede funcionar con su automatización desactivada.</p>
      <Link to='?view=audio'>Abrir catálogo de audios</Link>
      {error && (
        <>
          <p className={styles.error} role='alert'>{error}</p>
          <Button onClick={() => setRetry(value => value + 1)}>Recargar audios</Button>
        </>
      )}
    </div>
  )
}
