import React from 'react'
import { canOperate } from 'shared/permissions'
import { Routes, Route, Navigate, useLocation } from 'react-router'
import { useAppSelector } from 'store/hooks'

import AccountView from 'routes/Account/views/AccountView'
import LibraryView from 'routes/Library/views/LibraryView'
import QueueView from 'routes/Queue/views/QueueView'
import ParticipantView from 'routes/Participant/ParticipantView'
import JoinView from 'routes/Account/views/JoinView'
import AdminRoutes from 'components/Admin/AdminRoutes'

const PlayerView = React.lazy(() => import('routes/Player/views/PlayerView'))

const AppRoutes = () => {
  const isAdmin = useAppSelector(state => canOperate(state.user))
  return (
    <Routes>
      <Route path='/join' element={<JoinView />} />
      <Route path='/account' element={<AccountView />} />
      <Route path='/admin/*' element={<AdminRoutes />} />
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
            {isAdmin ? <AdminQueue /> : <ParticipantView page='room' />}
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

function AdminQueue () {
  const location = useLocation()
  return location.hash === '#animator' ? <Navigate to='/admin/settings/animator' replace /> : <QueueView />
}

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
  const user = useAppSelector(state => state.user)
  const { userId, tableAccessError } = user
  const isOperator = canOperate(user)
  const location = useLocation()

  if (!isOperator && tableAccessError) return <Navigate to='/join' replace />

  if (path === '/player' && !isOperator) {
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
