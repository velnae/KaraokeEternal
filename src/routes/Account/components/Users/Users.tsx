import React, { useCallback, useEffect, useState } from 'react'
import { roleLabels, type UserRole } from 'shared/permissions'
import { Link } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { clearUserFilters, closeUserEditor, fetchUsers, filterByGroup, filterByOnline, filterByRoom, openUserEditor, searchUsers, type UserWithRoomsAndRole } from '../../modules/users'
import { userGroup, userGroupLabels, type UserGroup } from '../../userGroups'
import { formatDateTime } from 'lib/dateTime'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import EditUser from './EditUser/EditUser'
import getUsers from '../../selectors/getUsers'
import styles from './Users.css'

function UserAccess ({ user }: { user: UserWithRoomsAndRole }) {
  const role = roleLabels[user.role as UserRole] || user.role
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
  const { isEditorOpen, filterOnline, filterRoomId, filterGroup = 'staff', query = '' } = useAppSelector(state => state.users)
  const allUsers = useAppSelector(state => state.users)
  const rooms = useAppSelector(state => state.rooms)
  const users = useAppSelector(getUsers)
  const groups: UserGroup[] = ['staff', 'registered', 'guests']
  const counts: Record<UserGroup, number> = { staff: 0, registered: 0, guests: 0, system: 0 }
  allUsers.result.forEach((id) => {
    counts[userGroup(allUsers.entities[id].role)]++
  })
  if (counts.system || filterGroup === 'system') groups.push('system')
  const createLabel = filterGroup === 'staff' ? 'Crear personal' : 'Crear cuenta'

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
    const displayName = user.name || user.username || `Usuario ${userId}`
    const showUsername = user.role !== 'guest' && user.username && user.username !== displayName

    return (
      <tr key={userId}>
        <td>
          <strong className={styles.username} translate='no'>{displayName}</strong>
          {showUsername && <small className={styles.displayName} translate='no'>{user.username}</small>}
          {userId === curUserId && <small className={styles.currentUser}>Tu cuenta</small>}
          <div className={styles.mobileAccess}><UserAccess user={user} /></div>
        </td>
        <td className={styles.accessColumn}><UserAccess user={user} /></td>
        <td className={styles.registeredColumn}>{formatDateTime(new Date(user.dateCreated * 1000))}</td>
        <td className={styles.actionsColumn}>
          {filterGroup !== 'system' && (userId === curUserId
            ? <Link className={styles.rowAction} to='/admin/account'>Mi cuenta</Link>
            : <Button variant='default' className={styles.rowAction} aria-label={`Editar a ${displayName}`} onClick={() => handleOpen(user)}>Editar</Button>)}
        </td>
      </tr>
    )
  })

  const roomOpts = rooms.result
    .filter(roomId => !!rooms.entities[roomId].numUsers || roomId === filterRoomId)
    .map(roomId => <option key={roomId} value={roomId}>{rooms.entities[roomId].name}</option>)

  const userFilter = (
    <select aria-label='Filtrar usuarios' onChange={handleFilterChange} value={filterOnline ? 'online' : filterRoomId || 'all'}>
      <option key='all' value='all'>Todos</option>
      <option key='online' value='online'>En línea</option>
      <optgroup label='En línea por sala'>
        {roomOpts}
      </optgroup>
    </select>
  )

  return (
    <Panel title='Usuarios'>
      <>
        <div className={styles.groups} role='group' aria-label='Tipo de cuenta'>
          {groups.map(group => <Button key={group} variant='default' aria-pressed={filterGroup === group} onClick={() => dispatch(filterByGroup(group))}>{`${userGroupLabels[group]} (${counts[group]})`}</Button>)}
        </div>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            Buscar
            <input type='search' aria-label='Buscar usuarios' placeholder='Nombre o usuario' value={query} onChange={event => dispatch(searchUsers(event.target.value))} />
          </label>
          <label className={styles.usersFilter}>
            Mostrar
            {userFilter}
          </label>
          <Button
            variant='default'
            className={styles.rowAction}
            aria-label='Actualizar usuarios'
            icon='REFRESH'
            size={20}
            disabled={loadState === 'loading'}
            onClick={() => {
              setLoadState('loading')
              void load()
            }}
          />
          {(filterGroup === 'staff' || filterGroup === 'registered') && <Button className={styles.createButton} onClick={() => handleOpen()} variant='primary'>{createLabel}</Button>}
        </div>
        <p className={styles.summary} role='status'>{loadState === 'loading' ? 'Cargando usuarios…' : loadState === 'ready' ? `${users.result.length} ${users.result.length === 1 ? 'cuenta visible' : 'cuentas visibles'}` : 'No se pudo cargar la lista.'}</p>
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
        <table className={styles.table} aria-label={`Cuentas: ${userGroupLabels[filterGroup]}`}>
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
            <p>{counts[filterGroup] ? 'No hay cuentas con estos filtros.' : filterGroup === 'guests' ? 'Todavía no ingresaron invitados.' : 'No hay cuentas en este grupo.'}</p>
            {counts[filterGroup] > 0 && <Button variant='default' className={styles.rowAction} onClick={() => dispatch(clearUserFilters())}>Limpiar filtros</Button>}
          </div>
        )}
        {isEditorOpen && (
          <EditUser onClose={handleClose} user={editorUser} group={filterGroup} />
        )}
      </>
    </Panel>
  )
}

export default Users
