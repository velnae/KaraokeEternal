import React, { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { formatDateTime } from 'lib/dateTime'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import EditRoom from './EditRoom/EditRoom'
import { closeRoomEditor, fetchRooms, filterByStatus, openRoomEditor } from 'store/modules/rooms'
import { filterByGroup, filterByRoom } from '../../modules/users'
import getRoomList from '../../selectors/getRoomList'
import styles from './Rooms.css'
import Tables from './Tables/Tables'
import { useNavigate } from 'react-router'

const Rooms = () => {
  const navigate = useNavigate()
  const [editorRoom, setEditorRoom] = useState(null)
  const [tablesRoomId, setTablesRoomId] = useState<number | null>(null)

  const { isEditorOpen, filterStatus } = useAppSelector(state => state.rooms)
  const rooms = useAppSelector(getRoomList)

  const dispatch = useAppDispatch()
  const handleClose = () => dispatch(closeRoomEditor())
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.currentTarget.value === 'all') dispatch(filterByStatus(false))
    else dispatch(filterByStatus(e.currentTarget.value))
  }
  const handleFilterUsers = (e: React.MouseEvent<HTMLElement>) => {
    dispatch(filterByGroup('guests'))
    dispatch(filterByRoom(parseInt(e.currentTarget.dataset.roomId)))
    navigate('/admin/users')
  }
  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    setEditorRoom(rooms.entities[parseInt(e.currentTarget.dataset.roomId || '0')])
    dispatch(openRoomEditor())
  }

  // once per mount
  useEffect(() => {
    dispatch(fetchRooms())
  }, [dispatch])

  if (tablesRoomId && rooms.entities[tablesRoomId]) {
    return <Tables key={tablesRoomId} room={rooms.entities[tablesRoomId]} onClose={() => setTablesRoomId(null)} />
  }

  const rows = rooms.result.map((roomId) => {
    const room = rooms.entities[roomId]
    return (
      <tr key={String(roomId)}>
        <td translate='no'><Button className={styles.nameButton} data-room-id={roomId} onClick={handleOpen}>{room.name}</Button></td>
        <td>
          <div className={styles.roomStatus}>
            <span className={styles.status} data-status={room.status}>{room.status === 'open' ? 'Abierta' : room.status === 'closed' ? 'Cerrada' : room.status}</span>
            {room.numUsers > 0 && (
              <Button
                className={styles.userCount}
                data-room-id={roomId}
                aria-label={`Ver usuarios de ${room.name}: ${room.numUsers} ${room.numUsers === 1 ? 'conexión' : 'conexiones'}`}
                title='Ver usuarios de la sala. El total incluye las pestañas y los reproductores conectados.'
                onClick={handleFilterUsers}
              >
                {room.numUsers}
                {' '}
                {room.numUsers === 1 ? 'conexión' : 'conexiones'}
              </Button>
            )}
            {room.numUsers === 0 && <span className={styles.noConnections}>Sin conexiones</span>}
          </div>
        </td>
        <td>{formatDateTime(new Date(room.dateCreated * 1000))}</td>
        <td>
          <Button
            variant='default'
            className={styles.tablesButton}
            aria-label={`Ver mesas de ${room.name}`}
            onClick={() => setTablesRoomId(roomId)}
          >
            Ver mesas
          </Button>
        </td>
      </tr>
    )
  })

  const roomsFilter = (
    <select aria-label='Filtrar salas' className={styles.roomsFilter} onChange={handleFilterChange} value={filterStatus === false ? 'all' : filterStatus as string}>
      <option key='all' value='all'>Todas</option>
      <option key='open' value='open'>Abiertas</option>
      <option key='closed' value='closed'>Cerradas</option>
    </select>
  )

  return (
    <Panel title='Salas' titleComponent={roomsFilter}>
      <>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Estado</th>
              <th>Fecha de creación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows}
          </tbody>
        </table>

        <div className={styles.actions}>
          <Button className={styles.createButton} onClick={handleOpen} variant='primary'>
            Crear sala
          </Button>
        </div>

        {isEditorOpen && <EditRoom onClose={handleClose} room={editorRoom} />}
      </>
    </Panel>
  )
}

export default Rooms
