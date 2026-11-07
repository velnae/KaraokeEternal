import React, { useId, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { saveModeration } from 'store/modules/prefs'
import Button from 'components/Button/Button'
import { findBlockedTerm, MODERATION_MAX_TERMS, normalizeModerationTerm, validateModeration } from 'shared/textModeration'
import styles from './ModerationPrefs.css'

export default function ModerationPrefs () {
  const saved = useAppSelector(state => state.prefs.moderation)
  const dispatch = useAppDispatch()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string[] | null>(null)
  const [entry, setEntry] = useState('')
  const [search, setSearch] = useState('')
  const [sample, setSample] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [entryError, setEntryError] = useState('')
  const [status, setStatus] = useState('')
  const terms = draft ?? saved.terms
  const dirty = draft !== null
  const filtered = terms.filter(term => term.includes(search.trim().toLowerCase()))
  const match = findBlockedTerm(sample, terms)

  const change = (next: string[]) => {
    setDraft(JSON.stringify(next) === JSON.stringify(saved.terms) ? null : next)
    setError('')
    setEntryError('')
    setStatus('')
  }
  const add = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    try {
      const term = normalizeModerationTerm(entry)
      if (terms.includes(term)) throw new Error('La palabra o frase ya está en el diccionario.')
      change(validateModeration({ terms: [...terms, term] }).terms)
      setEntry('')
      setSearch('')
      input.current?.focus()
    } catch (cause) { setEntryError((cause as Error).message) }
  }
  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    setError('')
    setEntryError('')
    try {
      await dispatch(saveModeration({ terms }))
      setDraft(null)
      setStatus('Diccionario guardado y aplicado a todas las salas.')
    } catch (cause) {
      setError((cause as Error).message || 'No se pudo guardar el diccionario. Intente nuevamente.')
    } finally { setBusy(false) }
  }

  return (
    <div className={styles.container}>
      <div className={styles.workspace}>
        <section className={styles.dictionary} aria-labelledby={`${id}-title`}>
          <header className={styles.header}>
            <h2 id={`${id}-title`}>Diccionario</h2>
            <span>{`${terms.length}/${MODERATION_MAX_TERMS} términos`}</span>
          </header>
          <form onSubmit={add} className={styles.add} noValidate>
            <label htmlFor={`${id}-entry`}>Agregar palabra o frase</label>
            <div className={styles.inputRow}>
              <input id={`${id}-entry`} ref={input} value={entry} maxLength={80} disabled={busy} onChange={event => setEntry(event.target.value)} aria-invalid={!!entryError} aria-describedby={`${id}-entry-help${entryError ? ` ${id}-entry-error` : ''}`} />
              <Button type='submit' variant='default' disabled={busy}>Agregar</Button>
            </div>
            <p id={`${id}-entry-help`}>Se unifican mayúsculas, tildes y espacios. No se duplican entradas.</p>
            {entryError && <p id={`${id}-entry-error`} className={styles.error} role='alert'>{entryError}</p>}
          </form>
          <label htmlFor={`${id}-search`}>Buscar en el diccionario</label>
          <input id={`${id}-search`} type='search' value={search} onChange={event => setSearch(event.target.value)} />
          <ul className={styles.list} aria-label='Términos bloqueados'>
            {filtered.map(term => (
              <li key={term}>
                <span>{term}</span>
                <Button disabled={busy} aria-label={`Quitar ${term}`} onClick={() => change(terms.filter(value => value !== term))}>Quitar</Button>
              </li>
            ))}
          </ul>
          {!terms.length && <p className={styles.hint}>No hay términos bloqueados. Las reglas de formato y longitud siguen vigentes.</p>}
          {!!terms.length && !filtered.length && <p className={styles.hint}>No hay coincidencias. Pruebe otra búsqueda.</p>}
        </section>
        <section className={styles.tester} aria-labelledby={`${id}-test-title`}>
          <h2 id={`${id}-test-title`}>Probar texto</h2>
          <p>Compruebe el diccionario antes de guardar. Esta prueba no publica mensajes ni genera voz.</p>
          <label htmlFor={`${id}-sample`}>Texto de prueba</label>
          <textarea id={`${id}-sample`} rows={4} maxLength={500} value={sample} onChange={event => setSample(event.target.value)} aria-describedby={`${id}-result`} />
          <p id={`${id}-result`} className={styles.result} data-blocked={!!match} role='status'>
            {!sample.trim() ? 'Escriba un nombre o mensaje para probarlo.' : match ? `Bloqueado por el término: “${match}”.` : 'Permitido por el diccionario.'}
          </p>
          <p className={styles.hint}>{`${dirty ? 'La prueba incluye sus cambios sin guardar.' : 'La prueba utiliza el diccionario guardado.'} Los límites de caracteres y las reglas de nombres se validan por separado.`}</p>
        </section>
      </div>
      {error && <p className={styles.error} role='alert'>{error}</p>}
      <footer className={styles.footer}>
        <p role='status'>{busy ? 'Guardando cambios…' : dirty ? 'Cambios sin guardar' : status || 'Sin cambios pendientes'}</p>
        <div className={styles.actions}>
          {dirty && (
            <Button
              disabled={busy}
              onClick={() => {
                setDraft(null)
                setError('')
                setEntryError('')
                setStatus('')
              }}
            >
              Descartar
            </Button>
          )}
          <Button variant='primary' disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
      </footer>
    </div>
  )
}
