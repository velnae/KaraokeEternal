import React, { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import combinedReducer from 'store/reducers'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchAccount } from 'store/modules/user'
import usersReducer, { sliceInjectNoOp } from '../../modules/users'
import About from '../../components/About/About'
import Account from '../../components/Account/Account'
import Prefs from '../../components/Prefs/Prefs'
import Rooms from '../../components/Rooms/Rooms'
import Users from '../../components/Users/Users'
import theme from 'styles/karaokeTheme.css'
import styles from './SignedInView.css'

const adminSections = [
  ['admin-rooms', 'Salas'],
  ['admin-users', 'Usuarios'],
  ['admin-prefs', 'Ajustes'],
  ['admin-branding', 'Marca del cliente'],
  ['admin-account', 'Mi cuenta'],
] as const

const SignedInView = ({ scrollContainerRef }: { scrollContainerRef: React.RefObject<HTMLDivElement | null> }) => {
  const location = useLocation()
  const { isAdmin } = useAppSelector(state => state.user)
  const headerHeight = useAppSelector(state => state.ui.headerHeight)
  const sliceExists = !!useAppSelector(state => state.users)
  const dispatch = useAppDispatch()

  if (isAdmin && !sliceExists) {
    combinedReducer.inject({ reducerPath: 'users', reducer: usersReducer })
    dispatch(sliceInjectNoOp()) // update store with new slice
  }

  // once per mount
  useEffect(() => {
    (async () => dispatch(fetchAccount()))()
  }, [dispatch])

  useEffect(() => {
    const section = adminSections.find(([id]) => location.hash === `#${id}`)
    const target = section && document.getElementById(section[0])
    const container = scrollContainerRef.current
    if (!target || !container) return
    // Scroll only the account panel; scrollIntoView also moves outer ancestors.
    container.scrollTo({
      top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - headerHeight - 12,
    })
  }, [location.hash, location.key, isAdmin, headerHeight, scrollContainerRef])

  return (
    <div className={`${theme.forms} ${styles.container}`}>
      {isAdmin && (
        <>
          <h1>Administración</h1>
          <nav className={styles.shortcuts} aria-label='Secciones de administración'>
            {adminSections.map(([id, name]) => (
              <Link key={id} to={{ pathname: '/account', hash: `#${id}` }}>{name}</Link>
            ))}
          </nav>
          <section id='admin-rooms'><Rooms /></section>
          <section id='admin-users'><Users /></section>
          <section id='admin-prefs'><Prefs /></section>
        </>
      )}
      <section id='admin-account'><Account /></section>
      <About />
    </div>
  )
}

export default SignedInView
