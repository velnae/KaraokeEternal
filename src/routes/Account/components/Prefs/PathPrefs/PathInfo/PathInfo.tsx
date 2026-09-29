import React from 'react'
import Modal from 'components/Modal/Modal'
import InputCheckbox from 'components/InputCheckbox/InputCheckbox'
import Button from 'components/Button/Button'
import styles from './PathInfo.css'
import type { Path } from 'shared/types'

interface PathInfoProps {
  onClose: () => void
  onRemove: (pathId: number) => void
  onUpdate: (pathId: number, data: object) => void
  path: Path
}

const PathInfo = ({ onClose, onRemove, onUpdate, path }: PathInfoProps) => {
  const handleChange = (data: Record<string, boolean>) => {
    onUpdate(path.pathId, data)
  }

  const handleRemove = () => onRemove(path.pathId)

  return (
    <Modal
      onClose={onClose}
      title='Carpeta de archivos multimedia'
      buttons={(
        <>
          <Button onClick={handleRemove} variant='danger'>Quitar carpeta</Button>
          <Button onClick={onClose} variant='primary'>Listo</Button>
        </>
      )}
    >
      <div>
        <p className={styles.path}>
          {path?.path}
          <br />
          <span className={styles.label}>ID de carpeta: </span>
          {path?.pathId}
        </p>

        <form className={styles.form}>
          <InputCheckbox
            label='Vigilar carpeta'
            defaultChecked={path?.prefs?.isWatchingEnabled}
            onChange={event => handleChange({ isWatchingEnabled: event.currentTarget.checked })}
          />
          <InputCheckbox
            label='Permitir eliminar el fondo del video'
            defaultChecked={path?.prefs?.isVideoKeyingEnabled}
            onChange={event => handleChange({ isVideoKeyingEnabled: event.currentTarget.checked })}
          />
        </form>
      </div>
    </Modal>
  )
}

export default PathInfo
