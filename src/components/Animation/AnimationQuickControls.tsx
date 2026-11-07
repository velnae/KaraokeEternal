import React from 'react'
import { Link } from 'react-router'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { showErrorMessage } from 'store/modules/ui'
import { animationRequest } from 'lib/animationApi'
import { ANIMATION_CANCEL } from 'shared/animation'
import Button from 'components/Button/Button'
import styles from './Animation.css'

export default function AnimationQuickControls ({ showLink = true, player = false }: { showLink?: boolean, player?: boolean }) {
  const snapshot = useAppSelector(state => state.animation.snapshot?.roomId === state.user.roomId ? state.animation.snapshot : null)
  const [error, setError] = React.useState('')
  const dispatch = useAppDispatch()
  const send = (type: string, payload: object) => {
    void animationRequest(type, payload).then(() => setError('')).catch((error) => {
      setError(error.message)
      if (player) dispatch(showErrorMessage(error.message))
    })
  }
  return (
    <div className={styles.quick}>
      {showLink && <Link to='/admin/settings/animator'>Animador</Link>}
      {snapshot?.active && <Button variant='danger' onClick={() => send(ANIMATION_CANCEL, { interventionId: snapshot.active?.interventionId })}>Detener anuncio</Button>}
      {error && <span role='alert'>{player ? 'No se pudo detener el anuncio. Intenta de nuevo.' : error}</span>}
    </div>
  )
}
