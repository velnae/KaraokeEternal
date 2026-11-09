import React, { useState } from 'react'
import { useAppSelector } from 'store/hooks'
import { useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import Modal from 'components/Modal/Modal'
import { usePlaylists } from './usePlaylists'
import type { SongSource } from 'shared/queueLifecycle'
import styles from './Playlists.css'

function SaveDialog ({ source, sourceId, title, onClose }: { source: SongSource, sourceId: string, title: string, onClose: () => void }) {
  const { data, busy, error, run } = usePlaylists()
  const [params] = useSearchParams()
  const [selected, setSelected] = useState(params.get('saveTo') || '')
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const destination = selected === 'new' ? 'new' : data?.playlists.some(list => String(list.playlistId) === selected) ? selected : String(data?.playlists[0]?.playlistId || 'new')
  const list = data?.playlists.find(list => String(list.playlistId) === destination)
  const alreadySaved = !!list?.items.some(item => item.song.source === source && item.song.sourceId === sourceId)
  return (
    <Modal title='Guardar en una lista' onClose={onClose}>
      {savedName
        ? (
            <div className={styles.manager}>
              <p className={styles.saved} role='status'>
                <Icon icon='CHECK' size={24} />
                {`Guardada en «${savedName}»`}
              </p>
              <div className={styles.actions}><Button autoFocus variant='primary' onClick={onClose}>Listo</Button></div>
            </div>
          )
        : (
            <form
              className={styles.manager}
              onSubmit={async (event) => {
                event.preventDefault()
                let id = destination
                if (destination === 'new') {
                  const created = await run('POST', '', { name })
                  if (!created) return
                  id = String(created.createdPlaylistId)
                  setSelected(id)
                  setName('')
                }
                const result = await run('POST', `/${id}/items`, { source, sourceId })
                if (result) setSavedName(result.playlists.find(list => String(list.playlistId) === id)?.name || 'Lista')
              }}
            >
              <p className={styles.songTitle} translate='no'>{title}</p>
              {error && <p role='alert' className={styles.notice}>{error}</p>}
              {!data && !error && <p role='status'>Cargando listas…</p>}
              {data && (
                <>
                  <label className={styles.field}>
                    Lista de destino
                    <select aria-label='Lista de destino' value={destination} onChange={event => setSelected(event.target.value)}>
                      {data.playlists.map(list => <option key={list.playlistId} value={list.playlistId}>{list.name}</option>)}
                      <option value='new'>Crear nueva lista…</option>
                    </select>
                  </label>
                  {destination === 'new' && (
                    <label className={styles.field}>
                      Nombre de la nueva lista
                      <input autoFocus required value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder='Ej. Música del local' />
                    </label>
                  )}
                  {alreadySaved && <p role='status' className={styles.help}>Esta canción ya está en la lista.</p>}
                  <div className={styles.actions}>
                    <Button variant='primary' type='submit' disabled={busy || alreadySaved}>{busy ? 'Guardando…' : 'Guardar canción'}</Button>
                  </div>
                </>
              )}
            </form>
          )}
    </Modal>
  )
}

export default function SaveToPlaylist ({ source, sourceId, title, compact = false }: { source: SongSource, sourceId: string, title: string, compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  if (!isAdmin) return null
  return (
    <>
      <Button className={compact ? styles.saveCompact : styles.save} aria-label={`Guardar ${title} en una lista`} title='Guardar en lista' onClick={() => setOpen(true)} icon={compact ? 'NAV_LIBRARY' : undefined} size={22}>{compact ? null : 'Guardar en lista'}</Button>
      {open && <SaveDialog source={source} sourceId={sourceId} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}
