import React, { useState } from 'react'
import Button from 'components/Button/Button'
import InputImage from 'components/InputImage/InputImage'
import styles from './Create.css'
import { GUEST_NAME_HELP, guestNameError, normalizeGuestName } from 'shared/guestName'

interface CreateProps {
  guest: boolean
  isSubmitting?: boolean
  username: string
  password: string
  onUsernameChange: (username: string) => void
  onPasswordChange: (password: string) => void
  onSubmit: (params: { name: string, image: Blob | undefined, passwordConfirm: string }) => void
  onFirstFieldRef: (el: HTMLInputElement | null) => void
}

const Create = ({
  guest,
  isSubmitting = false,
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onFirstFieldRef,
}: CreateProps) => {
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [image, setImage] = useState<Blob | undefined>(undefined)
  const nameError = guest ? guestNameError(name) : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setNameTouched(true)
    if (nameError) return
    onSubmit({ name: guest ? normalizeGuestName(name) : name, image, passwordConfirm })
  }

  return (
    <form
      className={styles.container}
      noValidate
      onSubmit={handleSubmit}
    >
      {!guest && (
        <>
          <input
            type='email'
            autoComplete='off'
            value={username}
            onChange={e => onUsernameChange(e.target.value)}
            placeholder='nombre de usuario o correo electrónico'
            ref={onFirstFieldRef}
          />
          <input
            type='password'
            autoComplete='new-password'
            value={password}
            onChange={e => onPasswordChange(e.target.value)}
            placeholder='contraseña'
          />
          <input
            type='password'
            autoComplete='new-password'
            placeholder='confirmar contraseña'
            value={passwordConfirm}
            onChange={e => setPasswordConfirm(e.target.value)}
          />
        </>
      )}

      {guest && <label htmlFor='guest-display-name'>Tu nombre</label>}
      <div className={styles.userDisplayContainer}>
        {!guest && <InputImage onSelect={setImage} />}
        <input
          type='text'
          id={guest ? 'guest-display-name' : undefined}
          placeholder={guest ? undefined : 'nombre para mostrar'}
          aria-label={guest ? 'Tu nombre' : 'Nombre para mostrar'}
          autoComplete='nickname'
          maxLength={guest ? undefined : 50}
          minLength={2}
          required
          aria-invalid={(nameTouched && !!nameError) || undefined}
          aria-describedby={guest ? `guest-name-help${nameTouched && nameError ? ' guest-name-error' : ''}` : undefined}
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => setNameTouched(true)}
          ref={guest ? onFirstFieldRef : undefined}
        />
      </div>

      {guest && <small id='guest-name-help'>{GUEST_NAME_HELP}</small>}
      {nameTouched && nameError && <small id='guest-name-error' role='alert'>{nameError}</small>}
      <Button type='submit' variant='primary' disabled={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}

export default Create
