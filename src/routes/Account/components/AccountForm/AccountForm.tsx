import React, { useEffect, useRef, useState } from 'react'
import { roleLabels, type UserRole } from 'shared/permissions'
import InputImage from 'components/InputImage/InputImage'
import { UserWithRole } from 'shared/types'
import styles from './AccountForm.css'
import { guestNameError, normalizeGuestName } from 'shared/guestName'
import { useAppSelector } from 'store/hooks'

interface AccountFormProps {
  autoFocus?: boolean
  children?: React.ReactNode
  onDirtyChange?(isDirty: boolean): void
  onSubmit(formData: FormData): void
  showRole?: boolean
  showUsername?: boolean
  showPassword?: boolean
  showImage?: boolean
  roleOptions?: readonly UserRole[]
  defaultRole?: UserRole
  user?: UserWithRole
}

const AccountForm = ({
  autoFocus,
  children,
  onDirtyChange,
  onSubmit,
  showRole,
  showUsername = true,
  showPassword = true,
  showImage = true,
  roleOptions = ['standard', 'operator', 'manager', 'admin'],
  defaultRole,
  user,
}: AccountFormProps) => {
  const terms = useAppSelector(state => state.prefs.moderation.terms)
  const username = useRef<HTMLInputElement>(null)
  const newPassword = useRef<HTMLInputElement>(null)
  const newPasswordConfirm = useRef<HTMLInputElement>(null)
  const name = useRef<HTMLInputElement>(null)
  const role = useRef<HTMLSelectElement>(null)
  const isGuest = user?.isGuest || user?.role === 'guest'
  const [checkedName, setCheckedName] = useState<string | null>(null)
  const nameError = isGuest && checkedName !== null ? guestNameError(checkedName, terms) : null
  const [prevDateUpdated, setPrevDateUpdated] = useState(user?.dateUpdated)
  const [state, setState] = useState({
    isDirty: false,
    isChangingPassword: showPassword && (!user || user.userId === null),
    userImage: undefined as Blob | undefined,
  })

  const prevIsDirty = useRef(state.isDirty)

  if (user && user.dateUpdated !== prevDateUpdated) {
    setPrevDateUpdated(user.dateUpdated)
    setState(prev => ({ ...prev, isDirty: false }))
  }

  useEffect(() => {
    if (onDirtyChange && prevIsDirty.current !== state.isDirty) {
      onDirtyChange(state.isDirty)
    }

    prevIsDirty.current = state.isDirty
  }, [state.isDirty, onDirtyChange])

  const updateDirty = () => {
    if (!user || user.userId === null) return

    setState(prev => ({
      ...prev,
      isDirty: !!username.current?.value || !!newPassword.current?.value
        || (name.current?.value !== user.name)
        || (role.current && role.current.value !== user.role),
      isChangingPassword: !!newPassword.current?.value,
    }))
  }

  const handleUserImageChange = (blob: Blob) => {
    setState(prev => ({
      ...prev,
      userImage: blob,
      isDirty: true,
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data = new FormData()
    if (isGuest) {
      const error = guestNameError(name.current?.value, terms)
      setCheckedName(name.current?.value ?? '')
      if (error) {
        name.current?.focus()
        return
      }
    }

    if (name.current?.value.trim()) {
      data.append('name', isGuest ? normalizeGuestName(name.current.value) : name.current.value.trim())
    }

    if (username.current?.value.trim()) {
      data.append('username', username.current.value.trim())
    }

    if (showPassword && state.isChangingPassword) {
      data.append('newPassword', newPassword.current?.value || '')
      data.append('newPasswordConfirm', newPasswordConfirm.current?.value || '')
    }

    if (typeof state.userImage !== 'undefined') {
      data.append('image', state.userImage)
    }

    if (role.current) {
      data.append('role', role.current.value)
    }

    onSubmit(data)
  }

  return (
    <form
      className={styles.container}
      key={user?.dateUpdated}
      noValidate
      onSubmit={handleSubmit}
    >
      {showUsername && (
        <input
          type='email'
          aria-label='Usuario o correo electrónico'
          autoComplete='off'
          autoFocus={autoFocus}
          onChange={updateDirty}
          placeholder={user && user.userId !== null ? 'cambiar nombre de usuario (opcional)' : 'nombre de usuario o correo electrónico'}
          // https://github.com/facebook/react/issues/23301
          ref={(r) => {
            if (r) username.current = r
            if (autoFocus) r?.setAttribute('autofocus', 'true')
          }}
        />
      )}

      {showPassword && (
        <input
          type='password'
          aria-label={user ? 'Nueva contraseña' : 'Contraseña'}
          autoComplete='new-password'
          onChange={updateDirty}
          placeholder={user && user.userId !== null ? 'cambiar contraseña (opcional)' : 'contraseña'}
          ref={newPassword}
        />
      )}

      {showPassword && state.isChangingPassword && (
        <input
          type='password'
          aria-label='Confirmar contraseña'
          autoComplete='new-password'
          placeholder={user && user.userId !== null ? 'confirmar nueva contraseña' : 'confirmar contraseña'}
          ref={newPasswordConfirm}
        />
      )}

      <div className={styles.userDisplayContainer}>
        {showImage && (
          <InputImage
            user={user}
            onSelect={handleUserImageChange}
          />
        )}
        <input
          type='text'
          autoFocus={autoFocus && !showUsername}
          defaultValue={user?.name ?? ''}
          onChange={() => {
            updateDirty()
            if (checkedName !== null && isGuest) setCheckedName(name.current?.value ?? '')
          }}
          placeholder='nombre para mostrar'
          aria-label='Nombre para mostrar'
          aria-invalid={!!nameError || undefined}
          aria-describedby={nameError ? 'account-name-error' : undefined}
          ref={name}
        />
      </div>
      {isGuest && guestNameError(user?.name, terms) && <p role='status'>Tu nombre aparece como “Invitado” en la pantalla. Corrígelo aquí y guarda los cambios.</p>}
      {nameError && <p id='account-name-error' role='alert'>{nameError}</p>}

      {showRole && (
        <select
          aria-label='Rol'
          defaultValue={user?.role || defaultRole}
          onChange={updateDirty}
          ref={role}
        >
          <option key='choose' value='' disabled>seleccione un rol...</option>
          {user?.role === 'guest' && <option key='guest' value='guest'>Invitado</option>}
          {roleOptions.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}
        </select>
      )}

      {children}
    </form>
  )
}

export default AccountForm
