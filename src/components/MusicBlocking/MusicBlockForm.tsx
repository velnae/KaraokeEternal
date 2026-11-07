import React, { useId, useState } from 'react'
import Button from 'components/Button/Button'
import { musicRuleKey, validateMusicBlocking, type MusicBlockRule } from 'shared/musicBlocking'
import { saveMusicBlocking } from 'store/modules/prefs'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { youtubeVideoId } from 'shared/youtubeSearch'
import styles from './MusicBlocking.css'

export default function MusicBlockForm ({ initial, onSaved }: { initial?: MusicBlockRule, onSaved?: () => void }) {
  const id = useId()
  const dispatch = useAppDispatch()
  const settings = useAppSelector(state => state.prefs.musicBlocking)
  const [kind, setKind] = useState<MusicBlockRule['kind']>(initial?.kind ?? 'artist')
  const [artist, setArtist] = useState(initial && initial.kind !== 'resource' ? initial.artist : '')
  const [title, setTitle] = useState(initial?.kind === 'song' ? initial.title : '')
  const [aliases, setAliases] = useState('')
  const [source, setSource] = useState<'YOUTUBE' | 'LOCAL'>(initial?.kind === 'resource' ? initial.source : 'YOUTUBE')
  const [sourceId, setSourceId] = useState(initial?.kind === 'resource' ? initial.sourceId : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setStatus('')
    try {
      const rule: MusicBlockRule = kind === 'artist'
        ? { kind, artist, aliases: aliases.split(',').map(value => value.trim()).filter(Boolean) }
        : kind === 'song'
          ? { kind, artist, title }
          : { kind, source, sourceId: source === 'YOUTUBE' ? youtubeVideoId(sourceId) ?? sourceId.trim() : sourceId.trim() }
      const validated = validateMusicBlocking({ rules: [rule] }).rules[0]
      if (settings.rules.some(existing => musicRuleKey(existing) === musicRuleKey(validated))) throw new Error('Este bloqueo ya existe. Puede quitarlo desde Música bloqueada.')
      setBusy(true)
      await dispatch(saveMusicBlocking({ rules: [...settings.rules, validated] }))
      setStatus('Bloqueo guardado y aplicado a todas las salas.')
      setArtist('')
      setTitle('')
      setSourceId('')
      setAliases('')
      onSaved?.()
    } catch (cause) {
      setError((cause as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <form className={styles.form} onSubmit={(event) => { void submit(event) }}>
      <h2>Agregar bloqueo</h2>
      <label htmlFor={`${id}-kind`}>Bloquear</label>
      <select id={`${id}-kind`} value={kind} disabled={!!initial || busy} onChange={event => setKind(event.target.value as MusicBlockRule['kind'])}>
        <option value='artist'>Artista completo</option>
        <option value='song'>Canción</option>
        <option value='resource'>Video o archivo</option>
      </select>
      {kind !== 'resource' && (
        <>
          <label htmlFor={`${id}-artist`}>Artista</label>
          <input id={`${id}-artist`} value={artist} onChange={event => setArtist(event.target.value)} maxLength={200} required disabled={busy} />
          <p>Confirme el artista: el canal de YouTube puede tener otro nombre.</p>
        </>
      )}
      {kind === 'artist' && (
        <>
          <label htmlFor={`${id}-aliases`}>Alias (separados por comas)</label>
          <input id={`${id}-aliases`} value={aliases} onChange={event => setAliases(event.target.value)} disabled={busy} />
        </>
      )}
      {kind === 'song' && (
        <>
          <label htmlFor={`${id}-title`}>Título de la canción</label>
          <input id={`${id}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required disabled={busy} />
        </>
      )}
      {kind === 'resource' && (
        <>
          <label htmlFor={`${id}-source`}>Origen</label>
          <select id={`${id}-source`} value={source} disabled={busy} onChange={event => setSource(event.target.value as 'YOUTUBE' | 'LOCAL')}>
            <option value='YOUTUBE'>YouTube</option>
            <option value='LOCAL'>Archivo local</option>
          </select>
          <label htmlFor={`${id}-resource`}>{source === 'YOUTUBE' ? 'Enlace o ID del video' : 'ID de la canción local'}</label>
          <input id={`${id}-resource`} value={sourceId} onChange={event => setSourceId(event.target.value)} maxLength={300} required disabled={busy} />
        </>
      )}
      <p>Se retirarán los pedidos coincidentes que esperan reproducción. La canción en curso no se interrumpe.</p>
      {error && <p role='alert'>{error}</p>}
      <p role='status'>{busy ? 'Guardando…' : status}</p>
      <Button type='submit' variant='primary' disabled={busy}>{busy ? 'Guardando…' : 'Guardar bloqueo'}</Button>
    </form>
  )
}
