import React, { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchRooms } from 'store/modules/rooms'
import styles from './Admin.css'

const sections = [
  ['/queue', 'Cola'], ['/library', 'Biblioteca'], ['/admin/playlists', 'Listas de reproducción'], ['/admin/rooms', 'Salas y mesas'], ['/admin/users', 'Usuarios'],
] as const
const settings = [
  ['/admin/settings/animator', 'Animador'], ['/admin/settings/playback', 'Reproducción'],
  ['/admin/settings/files', 'Archivos'], ['/admin/settings/branding', 'Marca del local'],
  ['/admin/settings/moderation', 'Moderación'],
  ['/admin/settings/music-blocking', 'Música bloqueada'],
] as const

export default function AdminNavigation () {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const location = useLocation()
  const open = openPath === location.pathname
  const room = useAppSelector(state => state.rooms.entities[state.user.roomId])
  const dispatch = useAppDispatch()
  useEffect(() => {
    void dispatch(fetchRooms())
  }, [dispatch])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPath(null)
        toggle.current?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])
  return (
    <>
      <button ref={toggle} className={styles.menu} aria-expanded={open} aria-controls='admin-navigation' onClick={() => setOpenPath(open ? null : location.pathname)}>
        {open ? 'Cerrar menú' : 'Abrir menú'}
        {' '}
        <span>Administración</span>
      </button>
      {open && (
        <button
          className={styles.backdrop}
          aria-label='Cerrar menú de administración'
          onClick={() => {
            setOpenPath(null)
            toggle.current?.focus()
          }}
        />
      )}
      <nav
        id='admin-navigation'
        className={styles.sidebar}
        data-open={open}
        aria-label='Secciones de administración'
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest('a')
          if (link) {
            setOpenPath(null)
            if (link.getAttribute('aria-current') === 'page') document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
          }
        }}
      >
        <div className={styles.identity}>
          <strong>Administración</strong>
          <span>{room?.name || 'Karaoke'}</span>
        </div>
        {sections.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        <h2>Ajustes</h2>
        {settings.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        <NavLink className={styles.account} to='/admin/account'>Mi cuenta</NavLink>
      </nav>
    </>
  )
}
