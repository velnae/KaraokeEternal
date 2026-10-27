import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { closeUserEditor, fetchUsers, filterByOnline, filterByRoom, openUserEditor, type UserWithRoomsAndRole } from '../../modules/users'
import { formatDateTime } from 'lib/dateTime'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import EditUser from './EditUser/EditUser'
import getUsers from '../../selectors/getUsers'
import styles from './Users.css'

function UserAccess ({ user }: { user: UserWithRoomsAndRole }) {
  const role = { guest: 'Invitado', standard: 'Usuario estándar', admin: 'Administrador' }[user.role] || user.role
  return (
    <div className={styles.access}>
      <span className={styles.role} data-role={user.role}>{role}</span>
      <span className={styles.connection} data-online={user.rooms.length > 0}>{user.rooms.length ? 'En línea' : 'Sin conexión'}</span>
    </div>
  )
}

const Users = () => {
  const [editorUser, setEditorUser] = useState<UserWithRoomsAndRole | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')

  const curUserId = useAppSelector(state => state.user.userId)
  const { isEditorOpen, filterOnline, filterRoomId } = useAppSelector(state => state.users)
  const rooms = useAppSelector(state => state.rooms)
  const users = useAppSelector(getUsers)

  const dispatch = useAppDispatch()
  const handleClose = () => dispatch(closeUserEditor())
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === 'all') dispatch(filterByOnline(false))
    else if (e.target.value === 'online') dispatch(filterByOnline(true))
    else dispatch(filterByRoom(parseInt(e.target.value, 10)))
  }

  const handleOpen = (user: UserWithRoomsAndRole | null = null) => {
    setEditorUser(user)
    dispatch(openUserEditor())
  }

  const load = useCallback(() => dispatch(fetchUsers()).unwrap()
    .then(() => setLoadState('ready'))
    .catch(() => setLoadState('failed')), [dispatch])
  useEffect(() => {
    void load()
  }, [load])

  const rows = users.result.map((userId) => {
    const user = users.entities[userId]
    const displayName = user.username || user.name || `Usuario ${userId}`

    return (
      <tr key={userId}>
        <td>
          <strong className={styles.username} translate='no'>{displayName}</strong>
          {user.username && user.name !== user.username && <small className={styles.displayName} translate='no'>{user.name}</small>}
          {userId === curUserId && <small className={styles.currentUser}>Tu cuenta</small>}
          <div className={styles.mobileAccess}><UserAccess user={user} /></div>
        </td>
        <td className={styles.accessColumn}><UserAccess user={user} /></td>
        <td className={styles.registeredColumn}>{formatDateTime(new Date(user.dateCreated * 1000))}</td>
        <td className={styles.actionsColumn}>
          {userId === curUserId
            ? <Link className={styles.rowAction} to='/admin/account'>Mi cuenta</Link>
            : <Button variant='default' className={styles.rowAction} aria-label={`Editar a ${displayName}`} onClick={() => handleOpen(user)}>Editar</Button>}
        </td>
      </tr>
    )
  })

  const roomOpts = rooms.result
    .filter(roomId => !!rooms.entities[roomId].numUsers || roomId === filterRoomId)
    .map(roomId => <option key={roomId} value={roomId}>{rooms.entities[roomId].name}</option>)

  const userFilter = (
    <select aria-label='Filtrar usuarios' onChange={handleFilterChange} value={filterOnline ? 'online' : filterRoomId || 'all'}>
      <option key='all' value='all'>Todos los usuarios</option>
      <option key='online' value='online'>En línea</option>
      <optgroup label='En línea por sala'>
        {roomOpts}
      </optgroup>
    </select>
  )

  return (
    <Panel title='Usuarios'>
      <>
        <div className={styles.toolbar}>
          <p role='status'>{loadState === 'loading' ? 'Cargando usuarios…' : loadState === 'ready' ? `${users.result.length} ${users.result.length === 1 ? 'usuario visible' : 'usuarios visibles'}` : 'No se pudo cargar la lista.'}</p>
          <label className={styles.usersFilter}>
            Mostrar
            {userFilter}
          </label>
        </div>
        {loadState === 'failed' && (
          <Button
            variant='default'
            className={styles.rowAction}
            onClick={() => {
              setLoadState('loading')
              void load()
            }}
          >
            Reintentar
          </Button>
        )}
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope='col'>Usuario</th>
              <th scope='col' className={styles.accessColumn}>Acceso</th>
              <th scope='col' className={styles.registeredColumn}>Fecha de registro</th>
              <th scope='col' className={styles.actionsColumn}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows}
          </tbody>
        </table>
        {loadState === 'ready' && !users.result.length && (
          <div className={styles.empty}>
            <p>No hay usuarios con este filtro.</p>
            <Button variant='default' className={styles.rowAction} onClick={() => dispatch(filterByOnline(false))}>Mostrar todos</Button>
          </div>
        )}
        <div className={styles.actions}>
          <Button className={styles.createButton} onClick={() => handleOpen()} variant='primary'>Crear usuario</Button>
        </div>

        {isEditorOpen && (
          <EditUser onClose={handleClose} user={editorUser} />
        )}
      </>
    </Panel>
  )
}

export default Users
