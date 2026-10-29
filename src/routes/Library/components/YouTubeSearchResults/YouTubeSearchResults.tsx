import React from 'react'
import { ensureState } from 'redux-optimistic-ui'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import SongResultCard from 'components/SongSearch/SongResultCard'
import { useSongRequests } from 'components/SongSearch/useSongRequests'
import { useConnection } from 'routes/Participant/useConnection'
import type { SongSearchResult } from 'shared/songSource'
import type { QueueItem } from 'shared/types'
import styles from './YouTubeSearchResults.css'
import { youtubeSearchCanRetry, youtubeSearchError } from 'shared/youtubeSearch'

interface YouTubeSearchResultsProps {
  code: string | null
  error: string | null
  isLoading: boolean
  query: string
  results: SongSearchResult[]
  onRetry?: () => void
}

export default function YouTubeSearchResults ({ code, error, isLoading, query, results, onRetry }: YouTubeSearchResultsProps) {
  const connected = useConnection()
  const user = useAppSelector(state => state.user)
  const queue = useAppSelector(state => ensureState(state.queue))
  const { controller, receipts } = useSongRequests()
  const house = useSongRequests('HOUSE')
  const own = Object.values(queue.entities).filter((item): item is QueueItem => item.isOptimistic !== true && item.userId === user.userId)
  return (
    <section className={styles.results} aria-label='Resultados de YouTube'>
      <div role='status' className={styles.message}>
        {!query && (
          <>
            <h2>Encuentra la versión que buscas</h2>
            <p>Escribe al menos 2 caracteres del título o artista, o pega un enlace de YouTube.</p>
          </>
        )}
        {isLoading && <p>Buscando en YouTube…</p>}
        {error && (
          <>
            <p>{!connected ? 'Sin conexión. La búsqueda continuará al reconectar.' : youtubeSearchError(code, true)}</p>
            {connected && onRetry && youtubeSearchCanRetry(code) && <Button variant='default' onClick={onRetry}>Reintentar búsqueda</Button>}
          </>
        )}
        {query && !isLoading && !error && <p>{results.length ? `${results.length} resultados` : 'Sin resultados. Prueba otro título, artista o tipo de video.'}</p>}
      </div>
      {results.map(result => (
        <SongResultCard
          key={result.sourceId}
          result={result}
          receipt={receipts[result.sourceId]}
          active={own.find(item => item.origin === 'PARTICIPANT' && item.externalId === result.sourceId && ['APPROVED', 'PENDING_APPROVAL', 'PLAYING'].includes(item.status))}
          house={{
            receipt: house.receipts[result.sourceId],
            active: own.find(item => item.origin === 'HOUSE' && item.externalId === result.sourceId && ['APPROVED', 'PLAYING'].includes(item.status)),
            onRequest: () => { void house.controller.request(result.sourceId, result.title) },
          }}
          admin
          connected={connected}
          blocker={!connected ? 'Sin conexión. Espera a reconectar para agregar la canción.' : queue.isLoading ? 'Actualizando la cola. Espera un momento.' : !user.roomId ? 'Entra a una sala desde Mi cuenta para agregar canciones.' : null}
          onRequest={(greeting) => { void controller.request(result.sourceId, result.title, greeting) }}
        />
      ))}
    </section>
  )
}
