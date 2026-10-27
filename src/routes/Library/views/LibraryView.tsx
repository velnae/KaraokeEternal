import React, { useState } from 'react'
import { useAppSelector } from 'store/hooks'
import { Link } from 'react-router'
import useResizeObserver from 'use-resize-observer'
import ArtistList from '../components/ArtistList/ArtistList'
import SearchResults from '../components/SearchResults/SearchResults'
import LibraryHeader from '../components/LibraryHeader/LibraryHeader'
import YouTubeSearchResults from '../components/YouTubeSearchResults/YouTubeSearchResults'
import { useYouTubeSearch } from 'routes/Participant/useYouTubeSearch'
import styles from './LibraryView.css'

export default function LibraryView () {
  const { isLoading, filterStr, filterStarred, searchSource, youtubeMode } = useAppSelector(state => state.library)
  const songs = useAppSelector(state => state.songs.result)
  const ui = useAppSelector(state => state.ui)
  const [retry, setRetry] = useState(0)
  const search = useYouTubeSearch(filterStr, youtubeMode, retry, searchSource === 'youtube')
  const { ref, height = 0, width = 0 } = useResizeObserver<HTMLDivElement>()
  const listUI = { ...ui, innerHeight: height, innerWidth: width, headerHeight: 0, footerHeight: 0 }
  return (
    <main className={styles.container} style={{ paddingTop: ui.headerHeight, paddingBottom: ui.footerHeight }}>
      <LibraryHeader onSearch={() => setRetry(value => value + 1)} />
      <div ref={ref} className={styles.content}>
        {searchSource === 'youtube'
          ? <div className={styles.youtube}><YouTubeSearchResults {...search} onRetry={() => setRetry(value => value + 1)} /></div>
          : isLoading
            ? <p className={styles.notice} role='status'>Cargando archivos locales…</p>
            : !songs.length
                ? (
                    <div className={styles.notice}>
                      <h2>No hay canciones locales</h2>
                      <p>
                        Agrega una carpeta de música en
                        {' '}
                        <Link to='/admin/settings/files'>Archivos</Link>
                        {' '}
                        o busca en YouTube.
                      </p>
                    </div>
                  )
                : height > 0 && (filterStr.trim() || filterStarred ? <SearchResults ui={listUI} /> : <ArtistList ui={listUI} contentTop={ui.innerHeight - ui.footerHeight - height} />)}
      </div>
    </main>
  )
}
