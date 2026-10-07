import React, { useEffect } from 'react'
import combinedReducer from 'store/reducers'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchAccount } from 'store/modules/user'
import usersReducer, { sliceInjectNoOp } from '../../modules/users'
import About from '../../components/About/About'
import Account from '../../components/Account/Account'
import Prefs from '../../components/Prefs/Prefs'
import Rooms from '../../components/Rooms/Rooms'
import Users from '../../components/Users/Users'
import theme from 'styles/karaokeTheme.css'
import styles from './SignedInView.css'

const SignedInView = () => {
  const { isAdmin } = useAppSelector(state => state.user)
  const sliceExists = !!useAppSelector(state => state.users)
  const dispatch = useAppDispatch()

  if (isAdmin && !sliceExists) {
    combinedReducer.inject({ reducerPath: 'users', reducer: usersReducer })
    dispatch(sliceInjectNoOp()) // update store with new slice
  }

  // once per mount
  useEffect(() => {
    (async () => dispatch(fetchAccount()))()
  }, [dispatch])

  return (
    <div className={`${theme.forms} ${styles.container}`}>
      {isAdmin && (
        <>
          <h1>Administración</h1>
          <nav className={styles.shortcuts} aria-label='Secciones de administración'>
            <a href='#admin-rooms'>Salas</a>
            <a href='#admin-users'>Usuarios</a>
            <a href='#admin-prefs'>Ajustes</a>
            <a href='#admin-account'>Mi cuenta</a>
          </nav>
          <section id='admin-rooms'><Rooms /></section>
          <section id='admin-users'><Users /></section>
          <section id='admin-prefs'><Prefs /></section>
        </>
      )}
      <section id='admin-account'><Account /></section>
      <About />
    </div>
  )
}

export default SignedInView
