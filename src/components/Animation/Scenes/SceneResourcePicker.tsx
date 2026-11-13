import React, { useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import SceneIconButton from './SceneIconButton'
import type { AnimationClip } from 'shared/animation'
import type { TransitionVideo } from 'shared/transitionVideo'
import styles from './Scenes.css'

export default function SceneResourcePicker ({ video, audio, videos, choose, close, refresh }: {
  video: boolean
  audio: AnimationClip[]
  videos: TransitionVideo[]
  choose(resource: AnimationClip | TransitionVideo): void
  close(): void
  refresh(): void
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const items = (video ? videos : audio).filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (video || kind === 'all' || ('kind' in item && item.kind === kind)))
  const hasResources = (video ? videos : audio).length > 0
  return (
    <Modal title={video ? 'Agregar video' : 'Agregar audio'} scrollable onClose={close}>
      <div className={styles.actions}>
        <label>
          Buscar recurso
          <input type='search' value={query} onChange={e => setQuery(e.target.value)} autoFocus />
        </label>
        {!video && (
          <label>
            Tipo
            <select value={kind} onChange={e => setKind(e.target.value)}>
              <option value='all'>Todos</option>
              <option value='voice'>Voz</option>
              <option value='effect'>Efectos</option>
              <option value='ambience'>Ambiente</option>
            </select>
          </label>
        )}
        {hasResources && <a href={new URL(`admin/settings/animator?view=${video ? 'background' : 'audio'}`, document.baseURI).href} target='_blank' rel='noreferrer'>Abrir biblioteca</a>}
        <SceneIconButton label='Actualizar biblioteca' icon='REFRESH' onClick={refresh} />
      </div>
      <div className={styles.resourceList}>
        {!items.length && (hasResources
          ? (
              <div className={styles.emptyResources}>
                <p role='status'>Sin coincidencias.</p>
                <Button
                  variant='default'
                  onClick={() => {
                    setQuery('')
                    setKind('all')
                  }}
                >
                  Limpiar búsqueda
                </Button>
              </div>
            )
          : (
              <div className={styles.emptyResources}>
                <p role='status'>{video ? 'No hay videos disponibles.' : 'No hay audios disponibles.'}</p>
                <a href={new URL(`admin/settings/animator?view=${video ? 'background' : 'audio'}`, document.baseURI).href} target='_blank' rel='noreferrer'>Abrir biblioteca</a>
              </div>
            ))}
        {items.map(item => (
          <div key={item.id} className={styles.resourceRow}>
            <span>
              {item.title}
              <small>
                {((item.durationMs ?? 0) / 1000).toFixed(1)}
                {' '}
                s
              </small>
            </span>
            <SceneIconButton label={`Agregar ${item.title}`} icon='PLUS' onClick={() => choose(item)} />
          </div>
        ))}
      </div>
    </Modal>
  )
}
