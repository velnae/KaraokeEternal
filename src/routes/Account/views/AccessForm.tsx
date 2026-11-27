import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import clsx from 'clsx'
import Button from 'components/Button/Button'
import ClientBranding from 'components/ClientBranding/ClientBranding'
import { tableMode, type TableInvitation } from 'shared/tableAccess'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchRooms } from 'store/modules/rooms'
import { createAccount, login } from 'store/modules/user'
import theme from 'styles/karaokeTheme.css'
import Create from './SignedOutView/Create/Create'
import SignIn from './SignedOutView/SignIn/SignIn'
import styles from './SignedOutView/SignedOutView.css'

type AccessFormProps = { access: 'staff' | 'guest' }
  | { access: 'table', destination: TableInvitation, invitation: string }

export default function AccessForm (props: AccessFormProps) {
  const { access } = props
  const staff = access === 'staff'
  const destination = access === 'table' ? props.destination : undefined
  const dispatch = useAppDispatch()
  const rooms = useAppSelector(state => state.rooms)
  const roles = useAppSelector(state => state.prefs.roles)
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<number | null | undefined>(() => Number(params.get('roomId')) || undefined)
  const [loading, setLoading] = useState(true)
  const [roomsUnavailable, setRoomsUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'guest' | 'returning' | 'standard'>(staff ? 'returning' : 'guest')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [roomPassword, setRoomPassword] = useState('')
  const firstField = useRef<HTMLInputElement | null>(null)
  const roomId = destination?.roomId ?? (selected === null || rooms.entities[selected] ? selected : rooms.result.length === 1 ? rooms.result[0] : null)
  const room = rooms.entities[roomId]
  const requiresQR = !staff && !destination && !!room && tableMode(room.prefs) === 'REQUIRED_QR'
  const allowed = (role: string) => roles.result.some(id => roles.entities[id].name === role && room?.prefs?.roles?.[id]?.allowNew)
  const allowGuest = !staff && !requiresQR && allowed('guest')
  const allowStandard = access === 'guest' && !requiresQR && allowed('standard')
  const canUseForm = !loading && (staff || (!!roomId && !requiresQR))
  const showName = canUseForm && mode === 'guest' && allowGuest
  const showSignIn = canUseForm && mode === 'returning'
  const showRegister = canUseForm && mode === 'standard' && allowStandard

  useEffect(() => {
    void dispatch(fetchRooms()).unwrap()
      .catch(() => setRoomsUnavailable(true))
      .finally(() => setLoading(false))
  }, [dispatch])

  useEffect(() => {
    if (showName || showSignIn || showRegister) firstField.current?.focus()
  }, [showName, showSignIn, showRegister])

  const submit = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const roomField = (destination?.hasPassword ?? room?.hasPassword) && (
    <label className={styles.field}>
      Contraseña de la sala
      <input type='password' value={roomPassword} onChange={e => setRoomPassword(e.target.value)} />
    </label>
  )
  const rememberField = (input: HTMLInputElement | null) => {
    firstField.current = input
  }
  const switchMode = (next: typeof mode) => {
    setPassword('')
    setMode(next)
  }

  return (
    <div className={clsx(theme.theme, styles.container, showName && styles.guestAccess)}>
      <ClientBranding className={styles.logo} />
      <div className={styles.panel}>
        <h1>{destination?.tableLabel ?? (staff ? 'Acceso del personal' : 'Entrar al karaoke')}</h1>
        {loading && <p role='status'>Buscando salas…</p>}
        {!destination && !loading && (rooms.result.length > 1 || (staff && !!rooms.result.length)) && (
          <label className={clsx(styles.field, styles.room)}>
            Sala
            <select
              value={roomId ?? ''}
              disabled={busy}
              onChange={(e) => {
                setSelected(Number(e.target.value) || null)
                setRoomPassword('')
                if (!staff) setMode('guest')
              }}
            >
              <option value=''>{staff ? 'Sin sala (administración)' : 'Seleccione una sala'}</option>
              {rooms.result.map(id => <option key={id} value={id}>{rooms.entities[id].name}</option>)}
            </select>
          </label>
        )}
        {requiresQR && <p role='status'>Escanee el QR de su mesa para entrar.</p>}
        {!staff && !destination && !loading && !rooms.result.length && !roomsUnavailable && <p role='status'>No hay salas abiertas.</p>}
        {canUseForm && !staff && mode === 'guest' && !allowGuest && !roomsUnavailable && <p role='status'>Esta sala no admite nuevos invitados.</p>}
        {showSignIn && (
          <SignIn
            username={username}
            password={password}
            onUsernameChange={setUsername}
            onPasswordChange={setPassword}
            onFirstFieldRef={rememberField}
            isSubmitting={busy}
            onSubmit={(e) => {
              e.preventDefault()
              void submit(() => dispatch(login({ access, username: username.trim(), password, roomId, roomPassword, invitation: access === 'table' ? props.invitation : undefined })))
            }}
          >
            {roomField}
          </SignIn>
        )}
        {(showName || showRegister) && (
          <Create
            key={mode}
            guest={showName}
            username={username}
            password={password}
            onUsernameChange={setUsername}
            onPasswordChange={setPassword}
            onFirstFieldRef={rememberField}
            isSubmitting={busy}
            onSubmit={({ name, image, passwordConfirm, avatarId }) => {
              const data = new FormData()
              data.set('role', mode)
              data.set('name', name.trim())
              data.set('roomId', String(roomId))
              data.set('roomPassword', roomPassword)
              if (avatarId) data.set('avatarId', avatarId)
              if (access === 'table') data.set('invitation', props.invitation)
              if (showRegister) {
                data.set('username', username.trim())
                data.set('newPassword', password)
                data.set('newPasswordConfirm', passwordConfirm)
                if (image) data.set('image', image)
              }
              void submit(() => dispatch(createAccount(data)))
            }}
          >
            {roomField}
          </Create>
        )}
        {!staff && canUseForm && (
          <div className={styles.secondary}>
            {mode !== 'returning' && <Button disabled={busy} onClick={() => switchMode('returning')}>Tengo una cuenta</Button>}
            {mode !== 'guest' && allowGuest && <Button disabled={busy} onClick={() => switchMode('guest')}>Entrar como invitado</Button>}
            {mode === 'returning' && allowStandard && <Button disabled={busy} onClick={() => switchMode('standard')}>Crear cuenta</Button>}
          </div>
        )}
      </div>
    </div>
  )
}
