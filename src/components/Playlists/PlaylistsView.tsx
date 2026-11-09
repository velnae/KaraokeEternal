import React, { useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import { Link, useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import SongArtwork from 'components/SongArtwork/SongArtwork'
import { usePlaylists } from './usePlaylists'
import PlaylistNameDialog from './PlaylistNameDialog'
import ImportYouTubePlaylistDialog from './ImportYouTubePlaylistDialog'
import styles from './Playlists.css'
import { shuffleOrder } from './shuffleOrder'

export default function PlaylistsView () {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const { roomId, data, busy, error, run, load, accept } = usePlaylists()
  const [params, setParams] = useSearchParams()
  const [dialog, setDialog] = useState<'create' | 'rename' | 'import' | null>(null)
  const [notice, setNotice] = useState('')
  const importTrigger = useRef<HTMLButtonElement | null>(null)
  const closeImport = () => {
    setDialog(null)
    requestAnimationFrame(() => importTrigger.current?.focus())
  }
  const selected = data?.playlists.find(list => String(list.playlistId) === params.get('list')) || data?.playlists[0]
  const selectedIsActive = data?.playback.enabled && data.playback.playlistId === selected?.playlistId
  const selectList = (id: number) => {
    setParams({ list: String(id) })
    setNotice('')
  }
  if (!roomId) return <p>Entre a una sala desde Mi cuenta para administrar sus listas.</p>
  return (
    <div className={styles.manager}>
      <div className={styles.toolbar}>
        {selected && (
          <label className={styles.listPicker}>
            Lista
            <select aria-label='Lista para editar' value={selected.playlistId} onChange={event => selectList(Number(event.target.value))}>
              {data!.playlists.map(list => <option key={list.playlistId} value={list.playlistId}>{list.name}</option>)}
            </select>
          </label>
        )}
        <div className={styles.actions}>
          {isAdmin && <Button variant='primary' disabled={busy} onClick={() => setDialog('create')}>Nueva lista</Button>}
          {isAdmin && (
            <Button
              variant='default'
              disabled={busy}
              onClick={(event) => {
                importTrigger.current = event.currentTarget
                setDialog('import')
              }}
            >
              Importar desde YouTube
            </Button>
          )}
          <Button className={styles.refresh} icon='REFRESH' size={20} aria-label='Actualizar listas' title='Actualizar listas' disabled={busy} onClick={() => void load()} />
        </div>
      </div>
      {error && !dialog && <p className={styles.notice} role='alert'>{error}</p>}
      {notice && <p role='status'>{notice}</p>}
      {!data && !error && <p role='status'>Cargando listas…</p>}
      {data?.playlists.length === 0 && (
        <div className={styles.empty}>
          <h2>Tu repertorio empieza aquí</h2>
          <p>{isAdmin ? 'Crea una lista y agrega canciones desde Biblioteca, o importa una lista de YouTube.' : 'Solicite al administrador que prepare una lista para el local.'}</p>
        </div>
      )}
      {selected && (
        <section className={styles.editor} aria-label='Editar lista guardada'>
          <div className={styles.editorHeading}>
            <h2>{`${selected.items.length} ${selected.items.length === 1 ? 'canción' : 'canciones'}`}</h2>
            {isAdmin && (
              <div className={styles.actions}>
                <Link className={styles.primaryLink} to={`/library?saveTo=${selected.playlistId}`}>Agregar canciones</Link>
                <Button
                  variant='default'
                  disabled={busy || selectedIsActive || selected.items.length < 2}
                  aria-describedby='shuffle-help'
                  onClick={async () => {
                    setNotice('')
                    const order = shuffleOrder(selected.items.map(item => item.itemId))
                    if (await run('PUT', `/${selected.playlistId}/order`, { order, requireInactive: true })) {
                      setNotice('Orden mezclado y guardado. Al activar la lista, comenzará en este orden y lo conservará al repetir.')
                    }
                  }}
                >
                  Mezclar y guardar
                </Button>
                <details className={styles.options} key={selected.playlistId}>
                  <summary>Opciones de la lista</summary>
                  <div className={styles.optionActions}>
                    <Button variant='default' disabled={busy} onClick={() => setDialog('rename')}>Cambiar nombre</Button>
                    <Button
                      variant='danger'
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`¿Eliminar la lista «${selected.name}»? La canción actual continuará.`)) return
                        if (await run('DELETE', `/${selected.playlistId}`)) setNotice('Lista eliminada.')
                      }}
                    >
                      Eliminar lista
                    </Button>
                  </div>
                </details>
              </div>
            )}
          </div>
          {isAdmin && (
            <p id='shuffle-help' className={styles.help}>
              {selectedIsActive
                ? 'Desactiva la lista en De la casa antes de mezclarla. La canción actual continuará.'
                : selected.items.length < 2
                  ? 'Agrega al menos dos canciones para mezclar el orden.'
                  : 'Guarda un orden aleatorio antes de activar la lista. Las repeticiones conservarán ese orden.'}
            </p>
          )}
          <ol className={styles.songs} aria-label='Canciones de la lista'>
            {selected.items.map((item, index) => (
              <li key={item.itemId}>
                <SongArtwork thumbnailUrl={item.song.thumbnailUrl} durationSeconds={item.song.durationSeconds} />
                <div>
                  <strong translate='no'>{item.song.title}</strong>
                  <p translate='no'>{item.song.artistOrChannel}</p>
                  <small>{item.song.source === 'YOUTUBE' ? 'YouTube' : 'Archivo local'}</small>
                </div>
                {isAdmin && (
                  <div className={styles.actions}>
                    {([-1, 1] as const).map(direction => (
                      <Button
                        key={direction}
                        variant='default'
                        aria-label={`${direction < 0 ? 'Subir' : 'Bajar'} ${item.song.title}`}
                        disabled={busy || index + direction < 0 || index + direction >= selected.items.length}
                        onClick={() => {
                          const order = selected.items.map(entry => entry.itemId)
                          const previous = order[index]
                          order[index] = order[index + direction]
                          order[index + direction] = previous
                          void run('PUT', `/${selected.playlistId}/order`, { order })
                        }}
                        icon={direction < 0 ? 'CHEVRON_UP' : 'CHEVRON_DOWN'}
                        size={20}
                      />
                    ))}
                    <Button variant='default' disabled={busy} aria-label={`Quitar ${item.song.title} de la lista`} onClick={() => void run('DELETE', `/${selected.playlistId}/items/${item.itemId}`)}>Quitar</Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!selected.items.length && <p className={styles.help}>Todavía no hay canciones en esta lista.</p>}
          <footer className={styles.listFooter}>
            <Link to={`/queue?view=house&playlist=${selected.playlistId}`}>Configurar en De la casa</Link>
          </footer>
        </section>
      )}
      {dialog === 'import' && (
        <ImportYouTubePlaylistDialog
          key={roomId}
          roomId={roomId}
          onClose={closeImport}
          onCreated={(result) => {
            accept(result)
            selectList(result.createdPlaylistId)
            closeImport()
            setNotice('Lista importada. Puedes editarla o configurarla en De la casa.')
          }}
        />
      )}
      {dialog && dialog !== 'import' && (
        <PlaylistNameDialog
          key={`${dialog}:${selected?.playlistId}`}
          creating={dialog === 'create'}
          initialName={dialog === 'rename' ? selected?.name : ''}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const result = dialog === 'create' ? await run('POST', '', { name }) : selected ? await run('PUT', `/${selected.playlistId}`, { name }) : null
            if (!result) return
            if (result.createdPlaylistId) selectList(result.createdPlaylistId)
            setDialog(null)
            setNotice(dialog === 'create' ? 'Lista creada.' : 'Nombre guardado.')
          }}
        />
      )}
    </div>
  )
}
