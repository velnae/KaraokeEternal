import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import styles from './Playlists.css'

export default function PlaylistNameDialog ({ initialName = '', creating, busy, error, onSave, onClose }: {
  initialName?: string
  creating: boolean
  busy: boolean
  error: string
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  return (
    <Modal title={creating ? 'Nueva lista' : 'Cambiar nombre'} onClose={onClose}>
      <form
        className={styles.manager}
        onSubmit={(event) => {
          event.preventDefault()
          void onSave(name)
        }}
      >
        <label className={styles.field}>
          Nombre de la lista
          <input ref={input => input?.setAttribute('autofocus', '')} autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder='Ej. Música del local' />
        </label>
        {error && <p className={styles.notice} role='alert'>{error}</p>}
        <div className={styles.actions}>
          <Button variant='primary' type='submit' disabled={busy}>{busy ? 'Guardando…' : creating ? 'Crear lista' : 'Guardar nombre'}</Button>
          <Button variant='default' onClick={onClose}>Cancelar</Button>
        </div>
      </form>
    </Modal>
  )
}
