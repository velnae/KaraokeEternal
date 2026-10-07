import React from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router'
import { useAppSelector } from 'store/hooks'

import AccountView from 'routes/Account/views/AccountView'
import LibraryView from 'routes/Library/views/LibraryView'
import QueueView from 'routes/Queue/views/QueueView'
import ParticipantView from 'routes/Participant/ParticipantView'

const PlayerView = React.lazy(() => import('routes/Player/views/PlayerView'))

const AppRoutes = () => {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  return (
    <Routes>
      <Route path='/account' element={<AccountView />} />
      <Route
        path='/library'
        element={(
          <RequireAuth path='/library' redirectTo='/account'>
            {isAdmin ? <LibraryView /> : <ParticipantView />}
          </RequireAuth>
        )}
      />
      <Route
        path='/queue'
        element={(
          <RequireAuth path='/queue' redirectTo='/account'>
            {isAdmin ? <QueueView /> : <ParticipantView page='room' />}
          </RequireAuth>
        )}
      />
      <Route
        path='/requests'
        element={(
          <RequireAuth path='/requests' redirectTo='/account'>
            <ParticipantView page='requests' />
          </RequireAuth>
        )}
      />
      <Route
        path='/player'
        element={(
          <RequireAuth path='/player' redirectTo='/account'>
            <PlayerView />
          </RequireAuth>
        )}
      />
      <Route
        path='/'
        element={(
          <Navigate
            to={{
              pathname: '/library',
              search: window.location.search, // pass through search params (e.g. roomId)
            }}
            replace
          />
        )}
      />
    </Routes>
  )
}

export default AppRoutes

interface RequireAuthProps {
  children: React.ReactNode
  path: string
  redirectTo: string
}

const RequireAuth = ({
  children,
  path,
  redirectTo,
}: RequireAuthProps) => {
  const { isAdmin, userId } = useAppSelector(state => state.user)
  const location = useLocation()

  if (path === '/player' && !isAdmin) {
    return <Navigate to='/' replace />
  }

  if (userId === null) {
    // set their originally-desired location in query parameter
    const params = new URLSearchParams(location.search)
    params.set('redirect', path)

    return <Navigate to={redirectTo + '?' + params.toString()} replace />
  }

  return children
}
