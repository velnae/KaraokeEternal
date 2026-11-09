import React from 'react'
import { Link, useSearchParams } from 'react-router'
import BirthdayHistory from './BirthdayHistory'
import BirthdaySettings from './BirthdaySettings'
import styles from './BirthdayHistory.css'

export default function BirthdayAdmin () {
  const [params] = useSearchParams()
  const settings = params.get('view') === 'settings'
  return (
    <>
      <nav className={styles.tabs} aria-label='Secciones de cumpleaños'>
        <Link to='?view=history' aria-current={!settings ? 'page' : undefined}>Historial</Link>
        <Link to='?view=settings' aria-current={settings ? 'page' : undefined}>Configuración</Link>
      </nav>
      {settings ? <BirthdaySettings /> : <BirthdayHistory />}
    </>
  )
}
