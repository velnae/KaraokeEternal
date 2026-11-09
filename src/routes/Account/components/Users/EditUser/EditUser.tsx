import React, { useState } from 'react'
import { useAppDispatch } from 'store/hooks'
import { createUser, removeUser, updateUser } from '../../../modules/users'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import AccountForm from '../../AccountForm/AccountForm'
import { UserWithRole } from 'shared/types'
import { staffRoles, userGroup, type UserGroup } from '../../../userGroups'
import styles from './EditUser.css'

interface EditUserProps {
  user?: UserWithRole
  onClose: () => void
  group: UserGroup
}

const EditUser = ({ user, onClose, group: selectedGroup }: EditUserProps) => {
  const dispatch = useAppDispatch()
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const group = user ? userGroup(user.role) : selectedGroup
  const guest = group === 'guests'
  const displayName = user?.name || user?.username
  const createLabel = group === 'staff' ? 'Crear personal' : 'Crear cuenta'
  const title = user ? `Editar ${guest ? 'invitado' : group === 'staff' ? 'personal' : 'cuenta'}: ${displayName}` : createLabel

  const handleSubmit = async (data: FormData) => {
    if (pending) return
    if (!user && group === 'registered') data.set('role', 'standard')
    setPending('save')
    try {
      if (user) await dispatch(updateUser({ userId: user.userId, data })).unwrap()
      else await dispatch(createUser(data)).unwrap()
    } catch { /* The existing error UI displays the server response. */ } finally { setPending(null) }
  }

  const handleRemoveClick = async () => {
    if (!user || pending || !confirm(`¿Eliminar a «${displayName}»?\n\nTambién se quitarán sus canciones de la cola de reproducción.`)) return
    setPending('delete')
    try {
      await dispatch(removeUser(user.userId)).unwrap()
    } catch { /* Keep the draft open when the server rejects the operation. */ } finally { setPending(null) }
  }

  return (
    <Modal
      className={styles.modal}
      onClose={() => { if (!pending) onClose() }}
      title={title}
    >
      <fieldset className={styles.fields} disabled={!!pending}>
        <AccountForm user={user} onSubmit={handleSubmit} showRole={group === 'staff'} roleOptions={staffRoles} defaultRole='operator' showUsername={!guest} showPassword={!guest} showImage={!guest} autoFocus={!user || guest}>
          <div className={styles.btnContainer}>
            {!user && (
              <Button type='submit' variant='primary'>
                {pending ? 'Creando…' : createLabel}
              </Button>
            )}

            {user && (
              <Button type='submit' variant='primary'>
                {pending === 'save' ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            )}

            {user && (
              <Button onClick={() => void handleRemoveClick()} variant='danger'>
                {pending === 'delete' ? 'Eliminando…' : guest ? 'Eliminar invitado' : 'Eliminar cuenta'}
              </Button>
            )}

            <Button onClick={onClose} variant='default'>
              Cancelar
            </Button>
          </div>
        </AccountForm>
      </fieldset>
    </Modal>
  )
}

export default EditUser
