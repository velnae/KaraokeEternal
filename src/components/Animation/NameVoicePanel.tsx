import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import type { NameVoiceDetail, NameVoiceSnapshot, NamePronunciation, NameVoiceVersion } from 'shared/nameVoices'
import PrivateCallAudio from './PrivateCallAudio'
import styles from './NameVoicePanel.css'
import formStyles from './KaraokeCallPilot.css'

const api = new HttpApi('name-voices')
const date = (time?: number | null) => time ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(time) : '—'
const pending = (item: NamePronunciation | NameVoiceDetail) => !!item.job && ['queued', 'generating', 'preparing'].includes(item.job.status)

export default function NameVoicePanel () {
  const [snapshot, setSnapshot] = useState<NameVoiceSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('name')
  const [archived, setArchived] = useState(false)
  const [offset, setOffset] = useState(0)
  const [editor, setEditor] = useState<{ id: string | null } | null>(null)
  const [detail, setDetail] = useState<NameVoiceDetail | null>(null)
  const [text, setText] = useState('')
  const [aliases, setAliases] = useState('')
  const [draftArchived, setDraftArchived] = useState(false)
  const [reassign, setReassign] = useState(false)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState<{ id: string, version: NameVoiceVersion } | null>(null)
  const alive = useRef(false)
  const editorId = useRef<string | null>(null)
  const editorGeneration = useRef(0)
  const draftRevision = useRef(0)
  const working = useRef(false)
  const sequence = useRef(0)
  const receipt = useRef<{ signature: string, id: string } | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const audioFocus = useRef<HTMLElement | null>(null)
  const invalidate = useCallback(() => {
    sequence.current++
  }, [])

  const refresh = useCallback(async () => {
    const current = ++sequence.current
    const result = await api.get<NameVoiceSnapshot>(`?${new URLSearchParams({ q: query, sort, archived: String(archived), offset: String(offset) })}`)
    if (alive.current && current === sequence.current) setSnapshot(result)
    const id = editorId.current
    const generation = editorGeneration.current
    if (id) {
      const item = await api.get<NameVoiceDetail>(`/${id}`)
      if (alive.current && editorId.current === id && generation === editorGeneration.current) setDetail(item)
    }
  }, [query, sort, archived, offset])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await refresh()
      } catch (err) { if (alive.current && active) setError((err as Error).message) }
      if (active) timer = setTimeout(() => void poll(), 2500)
    }
    timer = setTimeout(() => void poll(), 200)
    return () => {
      active = false
      invalidate()
      clearTimeout(timer)
    }
  }, [refresh, invalidate])
  useEffect(() => {
    if (editor) input.current?.focus()
  }, [editor, detail?.id])
  useEffect(() => {
    if (listening) preview.current?.scrollIntoView({ block: 'nearest' })
  }, [listening])

  const send = async <T extends object>(method: 'post' | 'put', suffix: string, body: object): Promise<T | undefined> => {
    if (working.current) return undefined
    working.current = true
    setBusy(true)
    setError('')
    setConflicts([])
    setNeedsReload(false)
    const signature = JSON.stringify([method, suffix, body])
    const generation = editorGeneration.current
    if (receipt.current?.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() }
    try {
      const result = await api[method]<T>(suffix, { body: { ...body, requestId: receipt.current.id } })
      receipt.current = null
      if (alive.current) await refresh()
      return result
    } catch (err) {
      let parsed: { error?: string, conflicts?: string[] } = {}
      try {
        parsed = JSON.parse((err as Error).message)
      } catch { /* Non-JSON proxy errors remain actionable text. */ }
      if (alive.current && generation === editorGeneration.current) {
        setError(parsed.error ?? (err as Error).message)
        setConflicts(parsed.conflicts ?? [])
        setNeedsReload((err as { status?: number }).status === 409 && !parsed.conflicts?.length)
      }
      return undefined
    } finally {
      working.current = false
      if (alive.current) setBusy(false)
    }
  }
  const populate = (item: NameVoiceDetail | null) => {
    draftRevision.current = item?.revision ?? 0
    setDetail(item)
    setText(item?.spokenText ?? '')
    setAliases(item?.aliases.join('\n') ?? '')
    setDraftArchived(item?.archived ?? false)
    setReassign(false)
    setConflicts([])
  }
  const open = async (id: string | null, trigger?: HTMLElement) => {
    const generation = ++editorGeneration.current
    returnFocus.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setError('')
    setNeedsReload(false)
    setListening(null)
    populate(null)
    editorId.current = id
    setEditor({ id })
    if (id) {
      try {
        const item = await api.get<NameVoiceDetail>(`/${id}`)
        if (alive.current && editorId.current === id && generation === editorGeneration.current) populate(item)
      } catch (err) { if (alive.current && generation === editorGeneration.current) setError((err as Error).message) }
    }
  }
  const close = () => {
    editorGeneration.current++
    editorId.current = null
    setEditor(null)
    setListening(null)
    setError('')
    requestAnimationFrame(() => {
      if (alive.current) {
        if (returnFocus.current?.isConnected) returnFocus.current.focus()
        else panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    })
  }
  const save = async () => {
    if (!editor) return
    const generation = editorGeneration.current
    const item = editor.id && detail
      ? await send<NameVoiceDetail>('put', `/${editor.id}`, { spokenText: text, aliases: aliases.split(/[\n,]+/).map(value => value.trim()).filter(Boolean), archived: draftArchived, revision: draftRevision.current, reassign })
      : await send<NameVoiceDetail>('post', '', { spokenText: text })
    if (item && alive.current && generation === editorGeneration.current) {
      editorId.current = item.id
      setEditor({ id: item.id })
      populate(item)
    }
  }
  const select = async (partId: string) => {
    if (!detail) return
    const generation = editorGeneration.current
    const revision = detail.revision
    const item = await send<NameVoiceDetail>('post', `/${detail.id}/select`, { partId, revision })
    if (item && generation === editorGeneration.current && draftRevision.current === revision) draftRevision.current = item.revision
  }
  const listen = (id: string, version: NameVoiceVersion, trigger: HTMLElement) => {
    audioFocus.current = trigger
    setListening({ id, version })
  }
  const closeAudio = () => {
    setListening(null)
    requestAnimationFrame(() => {
      if (alive.current && audioFocus.current?.isConnected) audioFocus.current.focus()
    })
  }
  const audio = listening && (
    <div ref={preview}>
      <PrivateCallAudio key={listening.version.part.id} part={listening.version.part} audioPath={`name-voices/${listening.id}/audio/${listening.version.part.id}`} label='Audio privado del nombre' onClose={closeAudio} />
    </div>
  )
  let unavailable = ''
  if (busy) unavailable = 'Procesando…'
  else if (detail && pending(detail)) unavailable = 'Preparando audio…'
  else if (detail?.archived) unavailable = 'Reactive la pronunciación y guarde los cambios para preparar una voz.'
  else if (!snapshot?.generation.allowed) unavailable = snapshot?.generation.message ?? 'Cargando el estado de generación…'

  return (
    <section ref={panel} className={styles.panel} aria-label='Banco global de nombres'>
      <header className={styles.heading}>
        <div>
          <h2>Nombres</h2>
          <span>Todas las salas</span>
        </div>
        <Button variant='primary' onClick={event => void open(null, event.currentTarget)}>Nueva pronunciación</Button>
      </header>
      <Link to='/admin/settings/audio-providers?use=names'>Configurar voz de nombres</Link>
      <div className={styles.toolbar}>
        <label className={formStyles.field}>
          Buscar nombre
          <input
            type='search'
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setOffset(0)
            }}
          />
        </label>
        <label className={formStyles.field}>
          Ordenar por
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value)
              setOffset(0)
            }}
          >
            <option value='name'>Nombre</option>
            <option value='generated'>Generación reciente</option>
            <option value='lastUsed'>Último uso</option>
            <option value='uses'>Más utilizados</option>
          </select>
        </label>
        <label className={styles.check}>
          <input
            type='checkbox'
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked)
              setOffset(0)
            }}
          />
          Incluir archivadas
        </label>
      </div>
      {error && !editor && <p role='alert' className={formStyles.error}>{error}</p>}
      {!snapshot && <p role='status'>Cargando nombres…</p>}
      {snapshot && !snapshot.items.length && <p>No se encontraron pronunciaciones.</p>}
      {!editor && audio}
      {!!snapshot?.items.length && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Pronunciación y nombres</th>
              <th>Generación</th>
              <th>Último uso</th>
              <th>Usos completos</th>
              <th><span className={styles.srOnly}>Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {snapshot.items.map((item) => {
              const version = item.active ?? item.latest
              return (
                <tr key={item.id} data-name-id={item.id}>
                  <td data-label='Pronunciación'>
                    <strong translate='no'>{item.spokenText}</strong>
                    <span className={styles.aliases} translate='no'>{item.aliases.join(', ') || 'Sin alias'}</span>
                    {item.archived && <span>Archivada</span>}
                  </td>
                  <td data-label='Generación'>
                    {version ? date(version.part.createdAt) : 'Sin generar'}
                    {version && !item.active && <small>{version.compatible ? 'Pendiente de selección' : 'Otra voz'}</small>}
                  </td>
                  <td data-label='Último uso'>{date(item.lastUsedAt)}</td>
                  <td data-label='Usos completos'>{item.uses}</td>
                  <td>
                    <div className={styles.actions}>
                      {version?.available && <Button aria-label={`Escuchar nombre ${item.spokenText}`} onClick={event => listen(item.id, version, event.currentTarget)}>Escuchar</Button>}
                      <Button aria-label={`Gestionar ${item.spokenText}`} onClick={event => void open(item.id, event.currentTarget)}>Gestionar</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {snapshot && snapshot.total > snapshot.limit && (
        <nav className={styles.actions} aria-label='Páginas de nombres'>
          <Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - snapshot.limit))}>Anterior</Button>
          <span>{`${offset + 1}–${Math.min(offset + snapshot.limit, snapshot.total)} de ${snapshot.total}`}</span>
          <Button disabled={offset + snapshot.limit >= snapshot.total} onClick={() => setOffset(offset + snapshot.limit)}>Siguiente</Button>
        </nav>
      )}
      {editor && (
        <Modal className={styles.editor} title={editor.id ? 'Gestionar pronunciación' : 'Nueva pronunciación'} onClose={close}>
          {error && <p role='alert' className={formStyles.error}>{error}</p>}
          {editor.id && !detail && <p role='status'>Cargando pronunciación…</p>}
          {(!editor.id || detail) && (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}
              >
                <label className={formStyles.field}>
                  Pronunciación
                  <input ref={input} value={text} maxLength={24} required onChange={event => setText(event.target.value)} />
                </label>
                {editor.id && (
                  <>
                    <label className={formStyles.field}>
                      Nombres asociados
                      <textarea rows={3} value={aliases} onChange={event => setAliases(event.target.value)} />
                    </label>
                    <label className={styles.check}>
                      <input type='checkbox' checked={draftArchived} onChange={event => setDraftArchived(event.target.checked)} />
                      Archivada
                    </label>
                  </>
                )}
                {!!conflicts.length && (
                  <label className={styles.check}>
                    <input type='checkbox' checked={reassign} onChange={event => setReassign(event.target.checked)} />
                    {`Reasignar: ${conflicts.join(', ')}`}
                  </label>
                )}
                <div className={styles.actions}>
                  <Button type='submit' variant='primary' disabled={busy}>{editor.id ? 'Guardar cambios' : 'Crear pronunciación'}</Button>
                  {needsReload && editor.id && <Button onClick={() => void open(editor.id)}>Recargar datos</Button>}
                </div>
              </form>
              {detail && (
                <section className={styles.versions} aria-label='Versiones de audio'>
                  <div className={styles.heading}>
                    <h3>Versiones de audio</h3>
                    <Button disabled={!!unavailable} aria-describedby={unavailable ? 'name-generation-status' : undefined} onClick={() => void send('post', `/${detail.id}/generate`, {})}>{detail.versions.length ? 'Regenerar voz' : 'Generar voz'}</Button>
                  </div>
                  <p className={styles.meta}>Generar o regenerar consume una solicitud de voz.</p>
                  {unavailable && (
                    <p id='name-generation-status' role='status' className={formStyles.warning}>
                      {unavailable}
                      {!snapshot?.generation.allowed && !busy && !pending(detail) && !detail.archived && <Link to='/admin/settings/audio-providers?use=calls'> Ajustes de voz</Link>}
                    </p>
                  )}
                  {detail.job?.error && <p role='alert' className={formStyles.error}>{detail.job.error}</p>}
                  {detail.legacyHistory && <p className={styles.meta}>Historial anterior parcial: se muestran usos confirmados.</p>}
                  {audio}
                  {!detail.versions.length && <p>Todavía no hay audio para esta pronunciación.</p>}
                  <ul className={styles.versionList}>
                    {detail.versions.map((version, index) => (
                      <li key={version.part.id} data-name-version={version.part.id}>
                        <div className={styles.heading}>
                          <strong>{date(version.part.createdAt)}</strong>
                          {version.selected && <span className={styles.selected}>{version.compatible ? 'Seleccionada' : 'Seleccionada para otra voz'}</span>}
                        </div>
                        <p translate='no'>{version.part.text}</p>
                        <p className={styles.meta}>{`${version.voice ?? 'Voz no registrada'} · ${version.model ?? 'Modelo no registrado'} · ${(version.part.durationMs / 1000).toFixed(1)} s`}</p>
                        <p className={styles.meta}>{`${version.uses} usos completos · Último uso: ${date(version.lastUsedAt)}`}</p>
                        <div className={styles.actions}>
                          {version.available ? <Button aria-label={`Escuchar versión ${index + 1} de ${detail.spokenText}`} onClick={event => listen(detail.id, version, event.currentTarget)}>Escuchar</Button> : <span>Archivo no disponible</span>}
                          {version.available && version.compatible && !version.selected && <Button aria-label={`Usar versión ${index + 1} de ${detail.spokenText}`} disabled={busy} onClick={() => void select(version.part.id)}>Usar esta versión</Button>}
                          {version.available && version.compatible && !detail.archived && !pending(detail) && <Button disabled={busy} onClick={() => void send('post', `/${detail.id}/generate`, { reprocessPartId: version.part.id })}>Reprocesar nivel</Button>}
                        </div>
                        {!version.compatible && (
                          <p className={styles.meta}>
                            Para usar esta versión, seleccione su voz en
                            {' '}
                            <Link to='/admin/settings/audio-providers?use=calls'>Ajustes de voz</Link>
                            .
                          </p>
                        )}
                        <details className={styles.instructions}>
                          <summary>Instrucciones de generación</summary>
                          <p>{version.style ?? 'Las instrucciones efectivas de esta versión anterior no quedaron registradas.'}</p>
                          {version.recipeRevision !== null && <small>{`Receta ${version.recipeRevision}`}</small>}
                        </details>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {busy && <p role='status'>Procesando…</p>}
            </>
          )}
        </Modal>
      )}
    </section>
  )
}
