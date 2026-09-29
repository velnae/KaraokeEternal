import React, { useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { requestLogout, updateAccount } from 'store/modules/user'
import { removeItem } from 'routes/Queue/modules/queue'
import getUpcoming from 'routes/Queue/selectors/getUpcoming'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import AccountForm from '../AccountForm/AccountForm'
import styles from './Account.css'

const Account = () => {
  const dispatch = useAppDispatch()
  const user = useAppSelector(state => state.user)
  const upcomingQueueIds = useAppSelector(state => getUpcoming(state, user.userId))

  const curPassword = useRef(null)
  const [isDirty, setDirty] = useState(false)

  const handleSignOut = () => {
    if (!user.isAdmin) {
      const hasUpcomingSongs = upcomingQueueIds.length > 0
      let message = ''

      if (user.isGuest && hasUpcomingSongs) {
        message = '¿Desea cerrar sesión?\n\nSe quitarán sus próximas canciones de la cola de reproducción y no podrá volver a entrar con esta cuenta de invitado.'
      } else if (user.isGuest) {
        message = '¿Desea cerrar sesión?\n\nNo podrá volver a entrar con esta cuenta de invitado.'
      } else if (hasUpcomingSongs) {
        message = '¿Desea cerrar sesión?\n\nSe quitarán sus próximas canciones de la cola de reproducción.'
      }

      if (message && !confirm(message)) return

      if (hasUpcomingSongs) {
        dispatch(removeItem({ queueId: upcomingQueueIds }))
      }
    }

    dispatch(requestLogout())
  }

  const handleSubmit = (data: FormData) => {
    if (!user.isGuest) {
      if (!curPassword.current.value.trim()) {
        alert('Ingrese su contraseña actual para guardar los cambios.')
        curPassword.current.focus()
        return
      }

      data.append('password', curPassword.current.value)
    }

    dispatch(updateAccount(data))
  }

  return (
    <Panel title='Mi cuenta' contentClassName={styles.content}>
      <>
        <p>
          Sesión iniciada como&nbsp;
          <strong>{user.isGuest ? 'invitado' : user.username}</strong>
        </p>

        <AccountForm
          user={user}
          onDirtyChange={setDirty}
          onSubmit={handleSubmit}
          showUsername={!user.isGuest}
          showPassword={!user.isGuest}
        >
          {isDirty && !user.isGuest && (
            <input
              type='password'
              autoComplete='current-password'
              placeholder='contraseña actual'
              ref={curPassword}
            />

          )}

          <div className={styles.btnContainer}>
            {isDirty && (
              <Button type='submit' variant='primary'>
                Actualizar cuenta
              </Button>
            )}
            <Button onClick={handleSignOut} variant='default'>
              Cerrar sesión
            </Button>
          </div>
        </AccountForm>
      </>
    </Panel>
  )
}

export default Account
