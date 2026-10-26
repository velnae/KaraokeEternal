import React, { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchAccount, joinTable } from 'store/modules/user'
import { fetchPrefs } from 'store/modules/prefs'
import HttpApi from 'lib/HttpApi'
import Button from 'components/Button/Button'
import SignedOutView from './SignedOutView/SignedOutView'
import type { TableInvitation } from 'shared/tableAccess'
import { tableMode } from 'shared/tableAccess'
import type { Room } from 'shared/types'

const api = new HttpApi()

export default function JoinView () {
  const location = useLocation()
  const dispatch = useAppDispatch()
  const user = useAppSelector(state => state.user)
  const headerHeight = useAppSelector(state => state.ui.headerHeight)
  const [invitation, setInvitation] = useState('')
  const [destination, setDestination] = useState<TableInvitation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [canContinue, setCanContinue] = useState(false)

  useEffect(() => {
    let active = true
    const token = location.hash.slice(1) || sessionStorage.getItem('tableInvitation') || ''
    if (token) sessionStorage.setItem('tableInvitation', token)
    setInvitation(token)
    setDestination(null)
    setError('')
    setLoading(true)
    void (async () => {
      await Promise.all([dispatch(fetchAccount()), dispatch(fetchPrefs())])
      if (token) {
        const resolved = await api.post<TableInvitation>('table-join/resolve', { body: { invitation: token } })
        if (active) setDestination(resolved)
      }
    })().catch((err: Error) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
    }
  }, [dispatch, location.hash])

  useEffect(() => {
    let active = true
    if (user.roomId) void api.get<{ entities: Record<number, Room> }>(`rooms/${user.roomId}`).then((rooms): void => {
      if (active) setCanContinue(tableMode(rooms.entities[user.roomId]?.prefs) !== 'REQUIRED_QR')
      return undefined
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [user.roomId])

  const enter = async (withoutTable = false) => {
    setBusy(true)
    setError('')
    try {
      await dispatch(joinTable({ roomId: withoutTable ? user.roomId : destination.roomId, invitation: withoutTable ? undefined : invitation, roomPassword: password })).unwrap()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ padding: `${headerHeight + 24}px 20px 100px`, maxWidth: 560, margin: 'auto' }}>
      {loading
        ? <p role='status'>Verificando mesa…</p>
        : user.isAdmin
          ? (
              <>
                <h1>Ingreso para cantantes</h1>
                <p>Use otro navegador para probar el QR como cantante.</p>
                <Link to='/account'>Volver a administración</Link>
              </>
            )
          : destination && !user.userId
            ? (
                <SignedOutView key={invitation} invitation={invitation} destination={destination} />
              )
            : (
                <>
                  <h1>{destination?.tableLabel ?? (error ? 'No se pudo abrir esta mesa' : 'Escanee el QR de su mesa')}</h1>
                  {destination && <p>{destination.roomName}</p>}
                  {user.userId && destination && (
                    <p>
                      {user.name}
                      , confirme su ingreso a esta mesa.
                    </p>
                  )}
                  {!destination && !error && <p>{user.tableAccessError ?? 'Use la cámara de su teléfono para abrir el QR que está en su mesa.'}</p>}
                  {((destination?.hasPassword && user.userId) || (!destination && canContinue && user.userId)) && (
                    <label>
                      Contraseña de la sala
                      <input type='password' value={password} onChange={e => setPassword(e.target.value)} />
                    </label>
                  )}
                  {destination && user.userId && <Button disabled={busy} variant='primary' onClick={() => void enter()}>Entrar a esta mesa</Button>}
                  {!destination && canContinue && user.userId && <Button disabled={busy} onClick={() => void enter(true)}>Continuar sin mesa</Button>}
                  {!user.userId && <Link to='/account'>Volver al ingreso</Link>}
                </>
              )}
      {error && <p role='alert'>{error}</p>}
    </main>
  )
}
