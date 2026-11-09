import React, { useState } from 'react'
import { useAppSelector } from 'store/hooks'
import { Link, useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import { usePlaylists } from './usePlaylists'
import styles from './Playlists.css'

function HouseForm ({ state, suggested }: { state: ReturnType<typeof usePlaylists>, suggested: string | null }) {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const { data, busy, run } = state
  const playback = data!.playback
  const [, setParams] = useSearchParams()
  const clearSuggestion = () => setParams((previous) => {
    const next = new URLSearchParams(previous)
    next.delete('playlist')
    return next
  }, { replace: true })
  const [selected, setSelected] = useState(suggested || String(playback.playlistId || ''))
  const [enabled, setEnabled] = useState(playback.enabled)
  const [repeat, setRepeat] = useState(playback.repeat)
  const list = data!.playlists.find(list => String(list.playlistId) === selected)
  const dirty = selected !== String(playback.playlistId || '') || enabled !== playback.enabled || repeat !== playback.repeat
  return (
    <form
      className={styles.houseForm}
      onSubmit={async (event) => {
        event.preventDefault()
        if (await run('PUT', '/playback', { playlistId: selected ? Number(selected) : null, enabled, repeat })) clearSuggestion()
      }}
    >
      <label className={styles.field}>
        Lista predeterminada
        <select aria-label='Lista predeterminada' value={selected} onChange={event => setSelected(event.target.value)}>
          <option value=''>Seleccione una lista</option>
          {data!.playlists.map(list => <option key={list.playlistId} value={list.playlistId}>{list.name}</option>)}
        </select>
      </label>
      <div className={styles.playbackOptions}>
        <label className={styles.check}>
          <input type='checkbox' checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          Activar lista
        </label>
        <label className={styles.check}>
          <input type='checkbox' checked={repeat} onChange={event => setRepeat(event.target.checked)} />
          Repetir al terminar
        </label>
      </div>
      {enabled && !list?.items.length && <p className={styles.notice}>Seleccione una lista con canciones para activarla.</p>}
      <div className={styles.actions}>
        {dirty
          ? (
              <>
                <Button type='submit' variant='primary' disabled={busy || (enabled && !list?.items.length)}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
                <Button
                  variant='default'
                  disabled={busy}
                  onClick={() => {
                    setSelected(String(playback.playlistId || ''))
                    setEnabled(playback.enabled)
                    setRepeat(playback.repeat)
                    clearSuggestion()
                  }}
                >
                  Cancelar cambios
                </Button>
                <span className={styles.help}>Cambios sin guardar</span>
              </>
            )
          : (
              <>
                {playback.enabled && playback.playlistId && <Button variant='default' disabled={busy} onClick={() => void run('PUT', '/playback', { playlistId: playback.playlistId, enabled: true, repeat: playback.repeat, restart: true })}>Reiniciar lista</Button>}
              </>
            )}
        <Link to={selected ? `/admin/playlists?list=${selected}` : '/admin/playlists'}>{isAdmin ? selected ? 'Editar lista' : 'Crear lista' : 'Ver listas'}</Link>
      </div>
    </form>
  )
}

export default function HousePlaylistControl () {
  const state = usePlaylists(true)
  const { data, error, roomId } = state
  const [params] = useSearchParams()
  const suggested = data?.playlists.some(list => String(list.playlistId) === params.get('playlist')) ? params.get('playlist') : null
  return (
    <section className={styles.house} aria-label='Lista diaria de la casa'>
      <header className={styles.editorHeading}>
        <h2>Lista de la casa</h2>
        {data && <span className={styles.playbackState} data-active={data.playback.enabled} role='status' aria-label='Estado de la lista de la casa'>{data.playback.enabled ? 'Activada' : 'Desactivada'}</span>}
      </header>
      {!roomId && <p>Entre a una sala desde Mi cuenta para configurar su música.</p>}
      {error && <p className={styles.notice} role='alert'>{error}</p>}
      {!data && roomId && !error && <p role='status'>Cargando listas…</p>}
      {data && (
        <>
          <HouseForm key={`${roomId}:${suggested}:${data.playback.playlistId}:${data.playback.enabled}:${data.playback.repeat}`} state={state} suggested={suggested} />
          {data.playback.message && <p role='status' className={styles.notice}>{data.playback.message}</p>}
          <details className={styles.helpDetails}>
            <summary>Cómo funciona</summary>
            <p>La selección queda guardada para los próximos días. La lista suena cuando no hay pedidos y se intercala según la configuración de la sala.</p>
            <p>Cambiar o desactivar la lista no corta la canción actual. Pausar el reproductor pausa toda la música.</p>
          </details>
        </>
      )}
    </section>
  )
}
