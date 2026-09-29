import React, { useState, useRef } from 'react'
import clsx from 'clsx'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { setFilterStr, resetFilterStr, toggleFilterStarred } from '../../modules/library'
import Button from 'components/Button/Button'
import styles from './LibraryHeader.css'

const LibraryHeader = () => {
  const dispatch = useAppDispatch()
  const { filterStr, filterStarred } = useAppSelector(state => state.library)

  const searchInput = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(filterStr)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value)
    dispatch(setFilterStr(event.target.value))
  }

  const clearSearch = () => {
    setValue('')
    dispatch(resetFilterStr())
  }

  const handleMagnifierClick = () => {
    if (value.trim()) clearSearch()
    else searchInput.current?.focus()
  }

  return (
    <div className={styles.container}>
      <Button
        className={clsx(styles.btnMagnifier, filterStr && styles.active)}
        icon='MAGNIFIER'
        aria-label={value.trim() ? 'Borrar búsqueda' : 'Buscar canciones'}
        onClick={handleMagnifierClick}
      />
      <input
        type='search'
        className={styles.searchInput}
        placeholder='buscar canciones'
        aria-label='buscar canciones'
        value={value}
        onChange={handleChange}
        ref={searchInput}
      />
      {filterStr && (
        <Button
          icon='CLEAR'
          aria-label='Borrar búsqueda'
          onClick={clearSearch}
          className={clsx(styles.btnClear, styles.active)}
        />
      )}
      <Button
        className={clsx(styles.btnStar, filterStarred && styles.active)}
        icon='STAR_FULL'
        aria-label={filterStarred ? 'Mostrar todas las canciones' : 'Mostrar favoritas'}
        onClick={() => dispatch(toggleFilterStarred())}
      />
    </div>
  )
}

export default LibraryHeader
