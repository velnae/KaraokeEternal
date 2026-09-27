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

  if (isLoading) return <div className={styles.message}>Searching YouTube…</div>

  if (error) {
    const message = code === 'YOUTUBE_UNCONFIGURED'
      ? 'YouTube search is not configured.'
      : code === 'YOUTUBE_QUOTA'
        ? 'The YouTube search quota has been exceeded.'
        : 'YouTube search is temporarily unavailable.'

    return (
      <div className={styles.message}>
        {message}
        <br />
        Local songs remain available.
      </div>
    )
  }

  if (query && results.length === 0) {
    return <div className={styles.message}>No playable YouTube results found.</div>
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
            aria-label={`Request ${result.title} from YouTube`}
            className={styles.add}
            icon='PLUS'
            onClick={() => dispatch(queueYouTubeSong(result.sourceId))}
            title='Request YouTube song'
          />
        </div>
      ))}
    </div>
  )
}

export default YouTubeSearchResults
