import React from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { formatDuration } from 'lib/dateTime'
import { closeSongInfo, setPreferredSong } from 'store/modules/songInfo'
import styles from './SongInfo.css'

const SongInfo = () => {
  const { isLoading, isVisible, songId, media } = useAppSelector(state => state.songInfo)

  const dispatch = useAppDispatch()
  const handleCloseSongInfo = () => dispatch(closeSongInfo())
  const handlePrefer = (mediaId: number) => dispatch(setPreferredSong({ songId, mediaId, isPreferred: true }))
  const handleRemovePrefer = (mediaId: number) => dispatch(setPreferredSong({ songId, mediaId, isPreferred: false }))

  const mediaDetails = media.result.map((mediaId) => {
    const item = media.entities[mediaId]
    const isPreferred = !!item.isPreferred

    return (
      <div key={item.mediaId} className={styles.media}>
        {item.path + (item.path.indexOf('/') === 0 ? '/' : '\\') + item.relPath}
        <br />
        <span className={styles.label}>Duración: </span>
        {formatDuration(item.duration)}
        <br />
        <span className={styles.label}>ID del archivo multimedia: </span>
        {mediaId}
        <br />
        <span className={styles.label}>Preferido: </span>
        {isPreferred
          && (
            <span>
              <strong>Sí</strong>
&nbsp;
              <a onClick={() => handleRemovePrefer(mediaId)}>(Quitar preferencia)</a>
            </span>
          )}
        {!isPreferred
          && (
            <span>
              No&nbsp;
              <a onClick={() => handlePrefer(mediaId)}>(Marcar como preferido)</a>
            </span>
          )}
      </div>
    )
  })

  return (
    <Modal
      visible={isVisible}
      onClose={handleCloseSongInfo}
      title='Información de la canción'
      // style={{
      //   width: '90%',
      //   height: '90%',
      // }}
    >
      <div className={styles.container}>
        <p>
          <span className={styles.label}>ID de la canción: </span>
          {songId}
          <br />
          <span className={styles.label}>Archivos multimedia: </span>
          {isLoading ? '?' : media.result.length}
        </p>

        <div className={styles.mediaContainer}>
          {isLoading ? <p>Cargando...</p> : mediaDetails}
        </div>

        <div>
          <Button variant='primary' onClick={handleCloseSongInfo}>
            Listo
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default SongInfo
