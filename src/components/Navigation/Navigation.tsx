import React from 'react'
import clsx from 'clsx'
import { NavLink } from 'react-router'
import Icon from 'components/Icon/Icon'
import { useAppSelector } from 'store/hooks'
import theme from 'styles/karaokeTheme.css'
import styles from './Navigation.css'

const Navigation = React.forwardRef<HTMLDivElement>((_, ref) => {
  const { isAdmin, userId } = useAppSelector(state => state.user)
  if (userId === null) return null
  const destinations = isAdmin
    ? [['/library', 'Biblioteca', 'MAGNIFIER'], ['/queue', 'Cola', 'NAV_SUBSCRIPTIONS'], ['/account', 'Administrar', 'TUNE']] as const
    : [['/library', 'Buscar', 'MAGNIFIER'], ['/requests', 'Mis pedidos', 'NAV_LIBRARY'], ['/queue', 'En la sala', 'TELEVISION_PLAY']] as const
  return (
    <nav aria-label='Navegación principal' className={clsx(theme.theme, styles.container, styles.participant)} ref={ref}>
      {destinations.map(([path, label, icon]) => (
        <NavLink key={path} to={path} className={({ isActive }) => clsx(isActive && styles.active)}>
          <Icon icon={icon} size={22} />
          <span className={styles.navLabel}>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
})

Navigation.displayName = 'Navigation'

export default Navigation
