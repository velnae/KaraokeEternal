import React, { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import combinedReducer from 'store/reducers'
import { fetchAccount } from 'store/modules/user'
import { fetchPrefs } from 'store/modules/prefs'
import usersReducer, { sliceInjectNoOp } from 'routes/Account/modules/users'
import theme from 'styles/karaokeTheme.css'
import styles from './Admin.css'

export default function AdminPage ({ title, description, children }: { title: string, description: string, children: React.ReactNode }) {
  const dispatch = useAppDispatch()
  const ready = useAppSelector(state => !!state.users)
  const headerHeight = useAppSelector(state => state.ui.headerHeight)
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    combinedReducer.inject({ reducerPath: 'users', reducer: usersReducer })
    dispatch(sliceInjectNoOp())
    dispatch(fetchAccount())
    dispatch(fetchPrefs())
  }, [dispatch])
  useEffect(() => {
    container.current?.scrollTo({ top: 0 })
    heading.current?.focus({ preventScroll: true })
  }, [location.key])
  return (
    <main ref={container} className={`${styles.page} ${theme.forms}`} style={{ paddingTop: headerHeight, scrollPaddingTop: headerHeight + 16 }}>
      <header className={styles.heading}>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </header>
      {ready ? children : <p role='status'>Cargando administración…</p>}
    </main>
  )
}
