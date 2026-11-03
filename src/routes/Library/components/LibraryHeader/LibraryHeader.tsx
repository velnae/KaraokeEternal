import React, { useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { resetFilterStr, setFilterStr, setSearchSource, setYouTubeMode, toggleFilterStarred } from '../../modules/library'
import Button from 'components/Button/Button'
import VideoTypeFilter from 'components/SongSearch/VideoTypeFilter'
import { useConnection } from 'routes/Participant/useConnection'
import styles from './LibraryHeader.css'

export default function LibraryHeader ({ onSearch }: { onSearch: (query: string) => void }) {
  const dispatch = useAppDispatch()
  const connected = useConnection()
  const { filterStr, filterStarred, searchSource, youtubeMode } = useAppSelector(state => state.library)
  const [value, setValue] = useState(filterStr)
  const input = useRef<HTMLInputElement>(null)
  return (
    <header className={styles.container}>
      <div className={styles.heading}>
        <h1>Biblioteca</h1>
        <fieldset className={styles.sources} aria-label='Buscar en'>
          <legend>Buscar en</legend>
          {(['youtube', 'local'] as const).map(source => (
            <label key={source}>
              <input type='radio' name='library-source' checked={searchSource === source} onChange={() => dispatch(setSearchSource(source))} />
              {source === 'youtube' ? 'YouTube' : 'Archivos locales'}
            </label>
          ))}
        </fieldset>
      </div>
      <form
        role='search'
        className={styles.search}
        onSubmit={(event) => {
          event.preventDefault()
          if (searchSource === 'youtube' && !connected) return
          onSearch(value)
        }}
      >
        <input
          ref={input}
          id='library-search'
          type='search'
          aria-label='buscar canciones'
          placeholder='Canción o artista'
          value={value}
          maxLength={200}
          enterKeyHint='search'
          onChange={(event) => {
            setValue(event.target.value)
            dispatch(setFilterStr(event.target.value))
          }}
        />
        {value && (
          <Button
            className={styles.clear}
            icon='CLEAR'
            size={20}
            aria-label='Borrar búsqueda'
            onClick={() => {
              setValue('')
              dispatch(setFilterStr(''))
              dispatch(resetFilterStr())
              input.current?.focus()
            }}
          />
        )}
        <Button className={styles.searchButton} type='submit' icon='MAGNIFIER' size={22} aria-label='Buscar canciones' disabled={searchSource === 'youtube' && (!connected || value.trim().length < 2)} />
      </form>
      {searchSource === 'youtube' && !connected && <p role='status'>Sin conexión. Espera a reconectar para buscar.</p>}
      {searchSource === 'youtube'
        ? <VideoTypeFilter value={youtubeMode} onChange={mode => dispatch(setYouTubeMode(mode))} />
        : (
            <label className={styles.favorites}>
              <input type='checkbox' checked={filterStarred} onChange={() => dispatch(toggleFilterStarred())} />
              Solo favoritas
            </label>
          )}
    </header>
  )
}
