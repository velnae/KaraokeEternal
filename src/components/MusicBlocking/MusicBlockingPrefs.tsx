import React, { useId, useState } from 'react'
import Button from 'components/Button/Button'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { saveMusicBlocking } from 'store/modules/prefs'
import { musicRuleKey, musicRuleLabel, normalizeMusicText, type MusicBlockRule } from 'shared/musicBlocking'
import MusicBlockForm from './MusicBlockForm'
import styles from './MusicBlocking.css'

export default function MusicBlockingPrefs () {
  const settings = useAppSelector(state => state.prefs.musicBlocking)
  const dispatch = useAppDispatch()
  const id = useId()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const remove = async (rule: MusicBlockRule) => {
    if (busy || !window.confirm(`¿Quitar el bloqueo de «${musicRuleLabel(rule)}»? Los pedidos retirados no se restauran.`)) return
    setBusy(true)
    setError('')
    try {
      await dispatch(saveMusicBlocking({ rules: settings.rules.filter(item => musicRuleKey(item) !== musicRuleKey(rule)) }))
      setStatus('Bloqueo quitado. Se permiten nuevos pedidos que no coincidan con otra regla.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally { setBusy(false) }
  }
  const filtered = settings.rules.filter(rule => normalizeMusicText(`${musicRuleLabel(rule)} ${rule.kind === 'artist' ? rule.aliases.join(' ') : ''}`).includes(normalizeMusicText(search)))
  return (
    <div className={styles.workspace}>
      <section className={styles.catalog} aria-label='Bloqueos actuales'>
        <h2>{`Bloqueos actuales (${settings.rules.length})`}</h2>
        <label htmlFor={id}>Buscar bloqueo</label>
        <input id={id} type='search' value={search} onChange={event => setSearch(event.target.value)} />
        <ul className={styles.list}>
          {filtered.map(rule => (
            <li key={musicRuleKey(rule)}>
              <div>
                <strong>{musicRuleLabel(rule)}</strong>
                <p>{rule.kind === 'artist' ? 'Artista completo' : rule.kind === 'song' ? 'Canción' : 'Recurso específico'}</p>
                {rule.kind === 'artist' && rule.aliases.length > 0 && <p>{`Alias: ${rule.aliases.join(', ')}`}</p>}
              </div>
              <Button disabled={busy} aria-label={`Quitar bloqueo de ${musicRuleLabel(rule)}`} onClick={() => { void remove(rule) }}>Quitar</Button>
            </li>
          ))}
        </ul>
        {!filtered.length && <p>{settings.rules.length ? 'No hay coincidencias. Pruebe otra búsqueda.' : 'No hay música bloqueada. Agregue un artista, canción o recurso.'}</p>}
        {error && <p role='alert'>{error}</p>}
        <p role='status'>{busy ? 'Guardando…' : status}</p>
      </section>
      <MusicBlockForm />
    </div>
  )
}
