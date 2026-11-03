import React, { useCallback, useEffect, useRef, useState } from 'react'
import { QRCode } from 'react-qrcode-logo'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchRooms } from 'store/modules/rooms'
import HttpApi from 'lib/HttpApi'
import Button from 'components/Button/Button'
import Panel from 'components/Panel/Panel'
import Modal from 'components/Modal/Modal'
import TablePrint from './TablePrint'
import type { Room } from 'shared/types'
import { tableMode, type RoomTable, type TableMode } from 'shared/tableAccess'
import styles from './Tables.css'

const api = new HttpApi()
const label = (table: RoomTable) => `Mesa ${table.code}${table.name ? ` · ${table.name}` : ''}`
const joinURL = (token: string) => new URL(`join#${token}`, document.baseURI).href
const modes: Record<TableMode, { label: string, description: string }> = {
  OFF: { label: 'Desactivado', description: 'Los cantantes entran sin asociarse a una mesa.' },
  OPTIONAL: { label: 'Opcional', description: 'Pueden entrar con el QR de su mesa o sin mesa.' },
  REQUIRED_QR: { label: 'Estricto por QR', description: 'Cada cantante necesita el QR de una mesa activa.' },
}
const statusLabels = { active: 'Activa', disabled: 'Desactivada', archived: 'Archivada' }
type TableQR = { table: RoomTable, token: string }

export default function Tables ({ room, onClose }: { room: Room, onClose: () => void }) {
  const dispatch = useAppDispatch()
  const branding = useAppSelector(state => state.prefs.branding)
  const [tables, setTables] = useState<RoomTable[]>([])
  const [{ mode, savedMode }, setAccess] = useState({ mode: tableMode(room.prefs), savedMode: tableMode(room.prefs) })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<RoomTable | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('current')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [qr, setQR] = useState<TableQR | null>(null)
  const [cards, setCards] = useState<TableQR[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)
  const prefix = `rooms/${room.roomId}/tables`
  const load = useCallback(async () => {
    const [nextTables, rooms] = await Promise.all([
      api.get<RoomTable[]>(prefix),
      api.get<{ entities: Record<number, Room> }>(`rooms/${room.roomId}`),
    ])
    const persistedMode = tableMode(rooms.entities[room.roomId]?.prefs)
    setTables(nextTables)
    setAccess(current => ({
      savedMode: persistedMode,
      mode: current.mode === current.savedMode ? persistedMode : current.mode,
    }))
  }, [prefix, room.roomId])

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message)).finally(() => setLoading(false))
  }, [load])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const credential = async (table: RoomTable): Promise<TableQR> => {
    const result = await api.get<{ invitation: string }>(`${prefix}/${table.tableId}/qr`)
    return { table, token: result.invitation }
  }
  const openEditor = (table: RoomTable | null = null) => {
    setEditing(table)
    setCode(table?.code ?? '')
    setName(table?.name ?? '')
    setError('')
    setEditorOpen(true)
  }
  const closeEditor = () => {
    if (busy) return
    setEditorOpen(false)
    setError('')
  }
  const closeQR = () => {
    if (busy) return
    setQR(null)
    setError('')
  }
  const changeStatus = (table: RoomTable, status: RoomTable['status']): void => void run(async (): Promise<void> => {
    if (status !== 'active' && !confirm(`¿${status === 'archived' ? 'Archivar' : 'Desactivar'} ${label(table)}? Se cerrarán sus sesiones.`)) return
    setTables(await api.put<RoomTable[]>(`${prefix}/${table.tableId}`, { body: { ...table, status } }))
    setCards([])
    setNotice(`${label(table)}: ${statusLabels[status].toLocaleLowerCase()}`)
  })
  const renewQR = (table: RoomTable): void => void run(async (): Promise<void> => {
    if (!confirm(`¿Renovar el QR de ${label(table)}? Reemplace la tarjeta impresa: el QR anterior dejará de admitir ingresos. Las sesiones actuales continuarán.`)) return
    const result = await api.post<{ invitation: string }>(`${prefix}/${table.tableId}/renew-qr`)
    setQR({ table, token: result.invitation })
    setCards([])
    setNotice('QR renovado. Reemplace la tarjeta impresa.')
  })
  const closeSessions = (table: RoomTable): void => void run(async (): Promise<void> => {
    if (!confirm(`¿Cerrar las sesiones de ${label(table)}? El QR seguirá válido para nuevos ingresos.`)) return
    setTables(await api.post<RoomTable[]>(`${prefix}/${table.tableId}/close-sessions`))
    setNotice(`Sesiones cerradas en ${label(table)}`)
  })
  const activeTables = tables.filter(table => table.status === 'active')
  const visibleTables = tables.filter(table => (
    (filter === 'current' ? table.status !== 'archived' : table.status === filter)
    && `${table.code} ${table.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ))
  const modeChanged = mode !== savedMode

  return (
    <Panel className={styles.panel} title={`Mesas de ${room.name}`} titleComponent={<Button className={styles.back} onClick={onClose}>Volver a salas</Button>}>
      <>
        <div className={styles.manager} aria-busy={busy || loading}>
          <header className={styles.heading}>
            <p>{`${activeTables.length} activas · ${tables.reduce((sum, table) => sum + table.participants, 0)} sesiones · ${tables.reduce((sum, table) => sum + table.pending, 0)} pedidos pendientes`}</p>
            <Button className={styles.primary} variant='primary' disabled={busy || loading} onClick={() => openEditor()}>Nueva mesa</Button>
          </header>

          <details className={styles.access}>
            <summary aria-label='Configurar acceso por mesas'>
              Acceso de cantantes
              <span>{modeChanged ? `${modes[savedMode].label} · Cambio sin guardar` : modes[savedMode].label}</span>
            </summary>
            <form
              className={styles.mode}
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const current = await api.get<{ entities: Record<number, Room> }>(`rooms/${room.roomId}`)
                  const saved = current.entities[room.roomId]
                  await api.put(`rooms/${room.roomId}`, { body: { name: saved.name, status: saved.status, prefs: { ...saved.prefs, tables: { mode } } } })
                  setAccess({ mode, savedMode: mode })
                  await dispatch(fetchRooms())
                  setNotice('Modo de acceso guardado')
                })
              }}
            >
              <div className={styles.modeField}>
                <label htmlFor='table-access-mode'>Acceso por mesas</label>
                <select id='table-access-mode' disabled={busy} value={mode} onChange={e => setAccess(current => ({ ...current, mode: e.target.value as TableMode }))} aria-describedby='table-mode-description'>
                  {Object.entries(modes).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
                </select>
                <p id='table-mode-description'>{modes[mode].description}</p>
              </div>
              <div className={styles.modeSave}>
                <span>{modeChanged ? 'Cambio sin guardar' : 'Configuración guardada'}</span>
                <Button className={styles.secondary} type='submit' disabled={busy || !modeChanged}>Guardar modo</Button>
              </div>
            </form>
          </details>

          {savedMode === 'OFF' && (
            <p className={styles.notice} role='status'>Los QR aún no admiten cantantes. En «Acceso de cantantes», guarde el modo opcional o estricto para habilitarlos.</p>
          )}

          {error && !editorOpen && !qr && <p className={styles.error} role='alert'>{error}</p>}
          {notice && <p className={styles.notice} role='status'>{notice}</p>}
          <div className={styles.toolbar}>
            <label className={styles.search}>
              Buscar mesa
              <input type='search' value={query} onChange={e => setQuery(e.target.value)} placeholder='Código o nombre' />
            </label>
            <label className={styles.filter}>
              Estado de mesas
              <select aria-label='Estado de mesas' value={filter} onChange={e => setFilter(e.target.value)}>
                <option value='current'>Sin archivar</option>
                <option value='active'>Activas</option>
                <option value='disabled'>Desactivadas</option>
                <option value='archived'>Archivadas</option>
              </select>
            </label>
          </div>
          <div className={styles.listHeading}>
            <span aria-live='polite'>{loading ? 'Cargando mesas…' : `${visibleTables.length} de ${tables.length} ${tables.length === 1 ? 'mesa' : 'mesas'}`}</span>
            <div className={styles.tools}>
              <Button className={styles.secondary} disabled={busy || loading} onClick={() => void run(load)}>Actualizar</Button>
              <Button className={styles.secondary} disabled={busy || loading || !activeTables.length} onClick={() => void run(async () => setCards(await Promise.all(activeTables.map(credential))))}>Imprimir mesas activas</Button>
            </div>
          </div>
          {!loading && !visibleTables.length && (
            <div className={styles.empty}>
              <h3>{tables.length ? 'No hay mesas con estos filtros' : 'La primera mesa empieza aquí'}</h3>
              <p>{tables.length ? 'Pruebe otro código, nombre o estado.' : 'Cree una mesa y prepare su tarjeta QR para los cantantes.'}</p>
              {tables.length > 0 && (
                <Button
                  className={styles.secondary}
                  onClick={() => {
                    setQuery('')
                    setFilter('current')
                  }}
                >
                  Limpiar filtros
                </Button>
              )}
            </div>
          )}
          <ul className={styles.list} aria-label='Mesas de la sala'>
            {visibleTables.map(table => (
              <li key={table.tableId} className={styles.row} data-status={table.status} aria-label={label(table)}>
                <div className={styles.tableIdentity}>
                  <span className={styles.code} aria-hidden='true'>{table.code}</span>
                  <div className={styles.tableName}>
                    <h3>{label(table)}</h3>
                    <span className={styles.status} data-status={table.status}>{statusLabels[table.status]}</span>
                  </div>
                </div>
                <dl className={styles.activity}>
                  <div>
                    <dt>Sesiones</dt>
                    <dd>{table.participants}</dd>
                  </div>
                  <div>
                    <dt>Pendientes</dt>
                    <dd>{table.pending}</dd>
                  </div>
                </dl>
                {table.status !== 'archived' && (
                  <div className={styles.rowActions}>
                    {table.status === 'active' && <Button className={styles.qrButton} disabled={busy} onClick={() => void run(async () => setQR(await credential(table)))}>Ver QR</Button>}
                    <Button className={styles.secondary} disabled={busy} onClick={() => openEditor(table)}>Editar</Button>
                  </div>
                )}
                {table.status !== 'archived' && (
                  <details className={styles.operations}>
                    <summary aria-label={`Gestionar ${label(table)}`}>
                      Gestionar
                      <span className={styles.operationHint}>Acceso y sesiones</span>
                    </summary>
                    <div className={styles.operationButtons}>
                      {table.status === 'active' && (
                        <>
                          <Button className={styles.secondary} disabled={busy} onClick={() => renewQR(table)}>Renovar QR</Button>
                          <Button className={styles.secondary} disabled={busy} onClick={() => closeSessions(table)}>Cerrar sesiones</Button>
                        </>
                      )}
                      <Button className={styles.secondary} disabled={busy} onClick={() => changeStatus(table, table.status === 'active' ? 'disabled' : 'active')}>{table.status === 'active' ? 'Desactivar' : 'Activar'}</Button>
                      <Button className={styles.danger} disabled={busy} onClick={() => changeStatus(table, 'archived')}>Archivar</Button>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>

        {editorOpen && (
          <Modal className={styles.editorDialog} title={editing ? `Editar ${label(editing)}` : 'Nueva mesa'} onClose={closeEditor}>
            <form
              className={styles.editor}
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const body = { code: code.trim(), name: name.trim(), status: editing?.status ?? 'active' }
                  const result = editing
                    ? await api.put<RoomTable[]>(`${prefix}/${editing.tableId}`, { body })
                    : await api.post<RoomTable[]>(prefix, { body })
                  setTables(result)
                  setEditorOpen(false)
                  setCards([])
                  setQuery('')
                  setFilter('current')
                  setNotice(editing ? 'Mesa actualizada' : `Mesa ${code.trim()} creada`)
                })
              }}
            >
              <label>
                Código
                <input type='text' required ref={input => input?.setAttribute('autofocus', '')} maxLength={20} value={code} onChange={e => setCode(e.target.value)} placeholder='05' disabled={busy} />
              </label>
              <label>
                Nombre opcional
                <input type='text' maxLength={50} value={name} onChange={e => setName(e.target.value)} placeholder='Terraza' disabled={busy} />
              </label>
              <p className={styles.help}>El código identifica la mesa dentro de esta sala.</p>
              {error && <p className={styles.error} role='alert'>{error}</p>}
              <div className={styles.dialogActions}>
                <Button className={styles.secondary} onClick={closeEditor} disabled={busy}>Cancelar</Button>
                <Button className={styles.primary} type='submit' variant='primary' disabled={busy || !code.trim()}>{busy ? 'Guardando…' : editing ? 'Guardar mesa' : 'Crear mesa'}</Button>
              </div>
            </form>
          </Modal>
        )}
        {qr && (
          <Modal className={styles.qrDialog} title={label(qr.table)} onClose={closeQR}>
            <div className={styles.qr}>
              <div className={styles.qrPaper} ref={canvasRef}>
                <p>{branding?.name || 'Karaoke'}</p>
                <strong>{room.name}</strong>
                <QRCode value={joinURL(qr.token)} size={200} quietZone={20} />
                <span>Escanee para elegir su canción</span>
              </div>
              <p className={styles.help}>QR fijo. Solo cambia cuando selecciona «Renovar QR».</p>
              {savedMode === 'OFF' && <p className={styles.notice}>Este QR está inactivo mientras el acceso por mesas esté desactivado.</p>}
              {notice.startsWith('QR renovado') && <p className={styles.notice} role='status'>{notice}</p>}
              {error && <p className={styles.error} role='alert'>{error}</p>}
              <div className={styles.dialogActions}>
                <Button
                  className={styles.secondary}
                  onClick={() => {
                    const canvas = canvasRef.current?.querySelector('canvas')
                    if (!canvas) return
                    const link = document.createElement('a')
                    link.download = `mesa-${qr.table.code}.png`
                    link.href = canvas.toDataURL('image/png')
                    link.click()
                  }}
                >
                  Descargar QR
                </Button>
                <Button
                  className={styles.primary}
                  variant='primary'
                  onClick={() => {
                    setCards([qr])
                    setQR(null)
                  }}
                >
                  Imprimir esta mesa
                </Button>
              </div>
            </div>
          </Modal>
        )}
        {cards.length > 0 && (
          <TablePrint
            roomName={room.name}
            cards={cards.map(({ table, token }) => ({ tableId: table.tableId, code: table.code, url: joinURL(token) }))}
            onClose={() => setCards([])}
          />
        )}
      </>
    </Panel>
  )
}
