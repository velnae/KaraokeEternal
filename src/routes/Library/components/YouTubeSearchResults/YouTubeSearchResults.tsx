import React from 'react'
import Button from 'components/Button/Button'
import { formatDuration } from 'lib/dateTime'
import { useAppDispatch } from 'store/hooks'
import { queueYouTubeSong } from 'routes/Queue/modules/queue'
import type { SongSearchResult } from 'shared/songSource'
import styles from './YouTubeSearchResults.css'

interface YouTubeSearchResultsProps {
  code: string | null
  error: string | null
  isLoading: boolean
  query: string
  results: SongSearchResult[]
}

const YouTubeSearchResults = ({ code, error, isLoading, query, results }: YouTubeSearchResultsProps) => {
  const dispatch = useAppDispatch()

  if (isLoading) return <div className={styles.message}>Buscando en YouTube…</div>

  if (error) {
    const message = code === 'YOUTUBE_UNCONFIGURED'
      ? 'La búsqueda en YouTube no está configurada.'
      : code === 'YOUTUBE_QUOTA'
        ? 'Se agotó la cuota de búsqueda de YouTube.'
        : 'La búsqueda en YouTube no está disponible temporalmente.'

    return (
      <div className={styles.message}>
        {message}
        <br />
        Las canciones locales siguen disponibles.
      </div>
    )
  }

  if (query && results.length === 0) {
    return <div className={styles.message}>No se encontraron videos de YouTube que se puedan reproducir.</div>
  }

  return (
    <div className={styles.results}>
      {results.map(result => (
        <div className={styles.result} key={result.sourceId}>
          <div className={styles.thumbnail}>
            {result.thumbnailUrl && <img src={result.thumbnailUrl} alt='' loading='lazy' />}
          </div>
          <div className={styles.primary} translate='no'>
            <div className={styles.title}>{result.title}</div>
            <div className={styles.channel}>{result.artistOrChannel}</div>
            <div className={styles.meta}>
              <span className={styles.source}>YouTube</span>
              {result.durationSeconds !== null && <span>{formatDuration(result.durationSeconds)}</span>}
            </div>
          </div>
          <Button
            aria-label={`Solicitar ${result.title} de YouTube`}
            className={styles.add}
            icon='PLUS'
            onClick={() => dispatch(queueYouTubeSong(result.sourceId))}
            title='Solicitar canción de YouTube'
          />
        </div>
      ))}
    </div>
  )
}

export default YouTubeSearchResults
