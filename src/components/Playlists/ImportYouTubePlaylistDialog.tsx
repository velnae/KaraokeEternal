import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import type { PlaylistSnapshot } from 'shared/playlists'
import { playlistOmissionReasons, type YouTubePlaylistPreview } from 'shared/youtubePlaylists'
import styles from './Playlists.css'

const api = new HttpApi()
type ImportedPlaylist = PlaylistSnapshot & { createdPlaylistId: number }

export default function ImportYouTubePlaylistDialog ({ roomId, onCreated, onClose }: {
  roomId: number
  onCreated: (result: ImportedPlaylist) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<YouTubePlaylistPreview | null>(null)
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<'reviewing' | 'saving' | null>(null)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => {
    request.current?.abort()
    request.current = null
  }, [])
  const submit = async () => {
    if (request.current || (preview && !preview.songs.length)) return
    const controller = new AbortController()
    request.current = controller
    setPhase(preview ? 'saving' : 'reviewing')
    setError('')
    const prefix = `rooms/${roomId}/playlists/import/youtube`
    try {
      if (preview) {
        const result = await api.post<ImportedPlaylist>(prefix, { body: { previewId: preview.previewId, name }, signal: controller.signal })
        if (!controller.signal.aborted) onCreated(result)
      } else {
        const result = await api.post<YouTubePlaylistPreview>(`${prefix}/preview`, { body: { url }, signal: controller.signal })
        if (!controller.signal.aborted) {
          setPreview(result)
          setName(result.suggestedName)
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = error as Error & { status?: number }
        setError(failure.status
          ? failure.message
          : preview
            ? 'No se recibió la confirmación. Pulsa Comprobar creación para recuperar el resultado sin duplicar la lista.'
            : 'No se pudo conectar. Comprueba tu conexión y vuelve a revisar el enlace.')
        setUncertain(!!preview && !failure.status)
        if (failure.status === 410) setPreview(null)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setPhase(null)
      }
    }
  }
  return (
    <Modal
      title='Importar desde YouTube'
      onClose={() => {
        if (phase !== 'saving') onClose()
      }}
    >
      <form
        className={styles.manager}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {!preview
          ? (
              <>
                <p className={styles.importIntro}>Pega el enlace de una lista y guarda sus canciones en esta sala.</p>
                <label className={styles.field}>
                  Enlace de la lista de YouTube
                  <input autoFocus ref={input => input?.setAttribute('autofocus', '')} type='url' required maxLength={2048} value={url} disabled={!!phase} onChange={event => setUrl(event.target.value)} placeholder='https://www.youtube.com/playlist?list=…' />
                </label>
                <p className={styles.help}>Hasta 200 videos. Música de hasta 7 minutos, sin directos.</p>
              </>
            )
          : (
              <>
                <p className={styles.importSummary} role='status'>
                  <strong>{preview.songs.length}</strong>
                  {preview.songs.length === 1 ? ' canción lista para importar' : ' canciones listas para importar'}
                </p>
                {preview.songs.length > 0
                  ? (
                      <>
                        <label className={styles.field}>
                          Nombre de la lista
                          <input autoFocus ref={input => input?.setAttribute('autofocus', '')} required maxLength={80} value={name} disabled={!!phase || uncertain} onChange={event => setName(event.target.value)} />
                        </label>
                        {preview.title.trim().length > 80 && <p className={styles.help}>Nombre ajustado al máximo de 80 caracteres. Puedes cambiarlo.</p>}
                      </>
                    )
                  : <p className={styles.notice}>Esta lista no tiene canciones que se puedan importar. Prueba con otro enlace.</p>}
                {preview.songs.length > 0 && (
                  <details className={styles.importDetails}>
                    <summary>{`Ver canciones (${preview.songs.length})`}</summary>
                    <ol className={styles.importSongs} aria-label='Canciones para importar'>
                      {preview.songs.map(song => (
                        <li key={song.sourceId}>
                          <span translate='no'>{song.title}</span>
                          <small translate='no'>{song.artistOrChannel}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {preview.omissions.length > 0 && (
                  <details className={styles.importDetails}>
                    <summary>{`${preview.omissions.length} ${preview.omissions.length === 1 ? 'video omitido' : 'videos omitidos'} · Ver motivos`}</summary>
                    <ul className={styles.importSongs} aria-label='Videos omitidos'>
                      {preview.omissions.map(item => (
                        <li key={item.position}>
                          <span translate='no'>{item.title}</span>
                          <small>{playlistOmissionReasons[item.reason]}</small>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className={styles.help}>Se guardará una copia en el orden de YouTube. Después puedes editarla y activarla en De la casa.</p>
              </>
            )}
        {error && <p role='alert' className={styles.notice}>{error}</p>}
        {phase && <p className={styles.help} role='status'>{phase === 'reviewing' ? 'Consultando YouTube y comprobando los videos…' : 'Guardando la lista. Espera la confirmación…'}</p>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={!!phase || (!!preview && !preview.songs.length)}>
            {phase === 'reviewing' ? 'Revisando…' : phase === 'saving' ? 'Creando…' : uncertain ? 'Comprobar creación' : preview ? 'Crear lista' : 'Revisar lista'}
          </Button>
          {preview && !uncertain && (
            <Button
              variant='default'
              disabled={!!phase}
              onClick={() => {
                setPreview(null)
                setError('')
              }}
            >
              Cambiar enlace
            </Button>
          )}
          <Button variant='default' disabled={phase === 'saving'} onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}
