import React, { useState } from 'react'
import Icon from 'components/Icon/Icon'
import { formatMediaDuration } from 'lib/dateTime'
import styles from './SongArtwork.css'

const SongArtwork = ({ thumbnailUrl, durationSeconds }: { thumbnailUrl?: string | null, durationSeconds?: number | null }) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const duration = formatMediaDuration(durationSeconds)
  return (
    <div className={styles.container}>
      {thumbnailUrl && thumbnailUrl !== failedUrl
        ? <img src={thumbnailUrl} alt='' width={320} height={180} loading='lazy' decoding='async' onError={() => setFailedUrl(thumbnailUrl)} />
        : <Icon icon='MICROPHONE' size={28} />}
      {duration && (
        <span className={styles.duration} aria-label={`Duración: ${duration}`}>
          {duration}
        </span>
      )}
    </div>
  )
}

export default SongArtwork
