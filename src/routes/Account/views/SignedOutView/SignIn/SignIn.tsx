import React from 'react'
import Button from 'components/Button/Button'
import styles from './SignIn.css'

interface SignInProps {
  username: string
  password: string
  onUsernameChange: (username: string) => void
  onPasswordChange: (password: string) => void
  onSubmit: (e: React.FormEvent) => void
  onFirstFieldRef: (el: HTMLInputElement | null) => void
  isSubmitting?: boolean
  children?: React.ReactNode
}

const SignIn = ({
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onFirstFieldRef,
  isSubmitting,
  children,
}: SignInProps) => {
  return (
    <form noValidate onSubmit={onSubmit} className={styles.container}>
      <input
        type='email'
        autoComplete='username'
        aria-label='Usuario o correo electrónico'
        placeholder='nombre de usuario o correo electrónico'
        value={username}
        onChange={e => onUsernameChange(e.target.value)}
        ref={onFirstFieldRef}
      />
      <input
        type='password'
        autoComplete='current-password'
        aria-label='Contraseña'
        placeholder='contraseña'
        value={password}
        onChange={e => onPasswordChange(e.target.value)}
      />
      {children}
      <Button type='submit' variant='primary' disabled={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Iniciar sesión'}
      </Button>
    </form>
  )
}

export default SignIn
