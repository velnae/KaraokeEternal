import React, { useId } from 'react'
import { youtubeSearchModes, type YouTubeSearchMode } from 'shared/youtubeSearch'
import styles from './SongSearch.css'

export default function VideoTypeFilter ({ value, onChange }: { value: YouTubeSearchMode, onChange: (value: YouTubeSearchMode) => void }) {
  const id = useId()
  return (
    <fieldset className={styles.filters} aria-describedby={`${id}-help`}>
      <legend>Tipo de video</legend>
      <div className={styles.options}>
        {youtubeSearchModes.map(mode => (
          <label key={mode.value}>
            <input type='radio' name={id} value={mode.value} checked={value === mode.value} onChange={() => onChange(mode.value)} />
            <span>{mode.label}</span>
          </label>
        ))}
      </div>
      <p id={`${id}-help`}>Orienta la búsqueda en YouTube. Revisa el título y el canal para elegir la versión.</p>
    </fieldset>
  )
}
