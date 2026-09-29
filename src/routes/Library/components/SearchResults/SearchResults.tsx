import React, { useEffect, useRef } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import { RootState } from 'store/store'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { clearYouTubeSearch, searchYouTube, toggleArtistResultExpanded } from '../../modules/library'
import getSearchResults from '../../selectors/getSearchResults'
import getSongsStatus from '../../selectors/getSongsStatus'
import PaddedList from 'components/PaddedList/PaddedList'
import ArtistItem from '../ArtistItem/ArtistItem'
import SongList from '../SongList/SongList'
import YouTubeSearchResults from '../YouTubeSearchResults/YouTubeSearchResults'
import type { ListImperativeAPI, RowComponentProps } from 'react-window'
import styles from './SearchResults.css'

const ROW_HEIGHT_RESULT_HEADING = 24
const ROW_HEIGHT_ARTIST = 48
const ROW_HEIGHT_SONG = 56 // 52px + 4px margin
const ROW_HEIGHT_SONG_WITH_ARTIST = 68 // 64px + 4px margin

interface SearchResultsProps {
  // starredArtistCounts: Record<number, number> // @todo
  ui: RootState['ui']
}

interface CustomRowProps {
  artists: RootState['artists']
  dispatch: ReturnType<typeof useAppDispatch>
  expandedArtists: number[]
  filterKeywords: string[]
  filterStarred: boolean
  artistsResult: number[]
  songsResult: number[]
  expandedArtistResults: number[]
  showYouTube: boolean
  youtubeSearch: RootState['library']['youtubeSearch']
}

// this is outside the SearchResults component to keep the reference as stable as possible,
// as react-window will re-render the list (breaking animations) when RowComponent changes
const RowComponent = ({
  index,
  style,
  // below are also used in SearchResults and passed via rowProps to avoid duplicate effort
  dispatch,
  artists,
  filterKeywords,
  filterStarred,
  artistsResult,
  songsResult,
  expandedArtistResults,
  showYouTube,
  youtubeSearch,
}: RowComponentProps<CustomRowProps>) => {
  const { starredSongs } = useAppSelector(state => ensureState(state.userStars))
  const { upcoming } = useAppSelector(getSongsStatus)

  // # artist results heading
  if (index === 0) {
    return (
      <div key='artistsHeading' style={style} className={styles.artistsHeading}>
        {artistsResult.length}
        {' '}
        {filterStarred ? (artistsResult.length === 1 ? 'artista favorito' : 'artistas favoritos') : (artistsResult.length === 1 ? 'artista' : 'artistas')}
      </div>
    )
  }

  // artist results
  if (index > 0 && index < artistsResult.length + 1) {
    const artistId = artistsResult[index - 1]
    const artist = artists.entities[artistId]

    return (
      <ArtistItem
        artistSongIds={artist.songIds}
        // numStars={props.starredArtistCounts[artistId] || 0}
        filterKeywords={filterKeywords}
        isExpanded={expandedArtistResults.includes(artistId)}
        key={artistId}
        name={artist.name}
        numStars={0}
        onArtistClick={() => dispatch(toggleArtistResultExpanded(artistId))}
        upcomingSongs={upcoming}
        starredSongs={starredSongs}
        style={style}
      />
    )
  }

  // # song results heading
  if (index === artistsResult.length + 1) {
    return (
      <div key='songsHeading' style={style} className={styles.songsHeading}>
        {songsResult.length}
        {' '}
        {filterStarred ? (songsResult.length === 1 ? 'canción favorita' : 'canciones favoritas') : (songsResult.length === 1 ? 'canción' : 'canciones')}
      </div>
    )
  }

  // song results
  if (index === artistsResult.length + 2) {
    return (
      <div style={style} key='songs'>
        <SongList
          songIds={songsResult}
          showArtist
          filterKeywords={filterKeywords}
        />
      </div>
    )
  }

  if (showYouTube && index === artistsResult.length + 3) {
    return <div style={style} className={styles.youtubeHeading}>Resultados de YouTube</div>
  }

  return (
    <div style={style} key='youtube'>
      <YouTubeSearchResults {...youtubeSearch} />
    </div>
  )
}

const SearchResults = ({ ui }: SearchResultsProps) => {
  const dispatch = useAppDispatch()
  const artists = useAppSelector(state => state.artists)
  const expandedArtistResults = useAppSelector(state => state.library.expandedArtistResults)
  const { filterStr, filterStarred, youtubeSearch } = useAppSelector(state => state.library)
  const { artistsResult, songsResult } = useAppSelector(getSearchResults)

  const listRef = useRef<ListImperativeAPI | null>(null)
  const filterKeywords = filterStr.trim() ? filterStr.trim().toLowerCase().split(' ') : []
  const youtubeQuery = filterStr.trim()
  const showYouTube = youtubeQuery.length >= 2 && !filterStarred

  useEffect(() => {
    if (showYouTube) dispatch(searchYouTube({ query: youtubeQuery }))
    else dispatch(clearYouTubeSearch())
  }, [dispatch, showYouTube, youtubeQuery])

  const rowHeight = (index: number) => {
    // artists heading
    if (index === 0) return ROW_HEIGHT_RESULT_HEADING

    // artist results
    if (index > 0 && index < artistsResult.length + 1) {
      const artistId = artistsResult[index - 1]
      let height = ROW_HEIGHT_ARTIST

      if (expandedArtistResults.includes(artistId)) {
        height += artists.entities[artistId].songIds.length * ROW_HEIGHT_SONG
      }

      return height
    }

    // songs heading
    if (index === artistsResult.length + 1) return ROW_HEIGHT_RESULT_HEADING

    // song results
    if (index === artistsResult.length + 2) return songsResult.length * ROW_HEIGHT_SONG_WITH_ARTIST

    // YouTube heading and result group
    if (index === artistsResult.length + 3) return ROW_HEIGHT_RESULT_HEADING
    return youtubeSearch.results.length ? youtubeSearch.results.length * 76 : 56
  }

  const handleRef = (ref: ListImperativeAPI) => {
    if (ref) {
      listRef.current = ref
      // listRef.current.scrollToRow({ index: props.scrollRow, align: 'start' })
    }
  }

  return (
    <PaddedList
      rowComponent={RowComponent}
      rowProps={{
        dispatch,
        artists,
        filterStarred,
        filterKeywords,
        artistsResult,
        songsResult,
        expandedArtistResults,
        showYouTube,
        youtubeSearch,
      }}
      rowHeight={rowHeight}
      numRows={artistsResult.length + 3 + (showYouTube ? 2 : 0)}
      paddingTop={ui.headerHeight}
      paddingRight={4}
      paddingBottom={ui.footerHeight}
      height={ui.innerHeight}
      onRef={handleRef}
    />
  )
}

export default SearchResults
