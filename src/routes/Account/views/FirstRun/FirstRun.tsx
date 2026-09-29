import React from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { createAccount } from 'store/modules/user'
import Button from 'components/Button/Button'
import Logo from 'components/Logo/Logo'
import AccountForm from '../../components/AccountForm/AccountForm'
import styles from './FirstRun.css'

const FirstRun = () => {
  const ui = useAppSelector(state => state.ui)

  const dispatch = useAppDispatch()
  const handleCreate = (data: FormData) => {
    dispatch(createAccount(data))
  }

  return (
    <div className={styles.container} style={{ maxWidth: Math.max(340, ui.contentWidth * 0.66) }}>
      <Logo className={styles.logo} />
      <h1>Bienvenido</h1>
      <p>
        Cree su cuenta de
        {' '}
        <b>administrador</b>
        {' '}
        para comenzar. Todos los datos se guardan localmente y nunca se comparten.
      </p>
      <AccountForm onSubmit={handleCreate} autoFocus>
        <Button variant='primary' type='submit'>
          Crear cuenta
        </Button>
      </AccountForm>
    </div>

  )
}

export default FirstRun
