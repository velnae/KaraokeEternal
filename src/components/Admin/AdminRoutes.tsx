import React from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAppSelector } from 'store/hooks'
import AdminPage from './AdminPage'
import Rooms from 'routes/Account/components/Rooms/Rooms'
import Users from 'routes/Account/components/Users/Users'
import Account from 'routes/Account/components/Account/Account'
import About from 'routes/Account/components/About/About'
import PlayerPrefs from 'routes/Account/components/Prefs/PlayerPrefs/PlayerPrefs'
import PathPrefs from 'routes/Account/components/Prefs/PathPrefs/PathPrefs'
import BrandingPrefs from 'routes/Account/components/Prefs/BrandingPrefs/BrandingPrefs'
import AnimatorSettings from './AnimatorSettings'
import PlaylistsView from 'components/Playlists/PlaylistsView'
import ModerationPrefs from 'routes/Account/components/Prefs/ModerationPrefs/ModerationPrefs'
import MusicBlockingPrefs from 'components/MusicBlocking/MusicBlockingPrefs'

export default function AdminRoutes () {
  const { isAdmin, userId } = useAppSelector(state => state.user)
  const location = useLocation()
  if (!isAdmin) return <Navigate to={userId === null ? `/account?redirect=${encodeURIComponent(location.pathname + location.search)}` : '/queue'} replace />
  return (
    <Routes>
      <Route index element={<Navigate to='rooms' replace />} />
      <Route path='rooms' element={<AdminPage title='Salas y mesas' description='Organice las salas, sus mesas y el acceso por código QR.'><Rooms /></AdminPage>} />
      <Route path='users' element={<AdminPage title='Usuarios' description='Revise quién participa y gestione sus permisos de acceso.'><Users /></AdminPage>} />
      <Route path='playlists' element={<AdminPage title='Listas de reproducción' description='Guarde el repertorio de la sala y reutilícelo todos los días.'><PlaylistsView /></AdminPage>} />
      <Route
        path='account'
        element={(
          <AdminPage title='Mi cuenta' description='Actualice sus datos de acceso o cierre la sesión de este dispositivo.'>
            <Account />
            <About />
          </AdminPage>
        )}
      />
      <Route path='settings/animator' element={<AdminPage title='Animador' description=''><AnimatorSettings /></AdminPage>} />
      <Route path='settings/playback' element={<AdminPage title='Reproducción' description='Ajuste el comportamiento del reproductor y el nivel de las canciones.'><PlayerPrefs /></AdminPage>} />
      <Route path='settings/files' element={<AdminPage title='Archivos' description='Administre las carpetas de música y actualice la biblioteca.'><PathPrefs /></AdminPage>} />
      <Route path='settings/branding' element={<AdminPage title='Marca del local' description='Personalice la identidad que ven sus participantes.'><BrandingPrefs /></AdminPage>} />
      <Route path='settings/moderation' element={<AdminPage title='Moderación' description='Gestione las palabras y frases bloqueadas en nombres y saludos de todas las salas.'><ModerationPrefs /></AdminPage>} />
      <Route path='settings/music-blocking' element={<AdminPage title='Música bloqueada' description='Bloquee artistas, canciones o videos en todas las salas. Los cambios se aplican al guardar.'><MusicBlockingPrefs /></AdminPage>} />
      <Route path='*' element={<Navigate to='/admin/rooms' replace />} />
    </Routes>
  )
}
