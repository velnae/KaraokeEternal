import React, { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import HttpApi from 'lib/HttpApi'
import type { CallPart, ListeningTemplate } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

const api = new HttpApi()
export default function ListeningTemplateManager ({ roomId, templates, unavailable, refresh, listen }: {
  roomId: number
  templates: ListeningTemplate[]
  unavailable: string
  refresh: () => Promise<void>
  listen: (part: CallPart) => void
}) {
  const id = useId()
  const [editor, setEditor] = useState<{ item?: ListeningTemplate } | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(false)
  const submitting = useRef(false)
  const receipt = useRef<{ signature: string, requestId: string } | null>(null)
  const textInput = useRef<HTMLTextAreaElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (editor) textInput.current?.focus()
  }, [editor])

  const send = async (method: 'post' | 'put', suffix: string, body: object) => {
    if (submitting.current) return false
    submitting.current = true
    setBusy(true)
    setError('')
    const signature = JSON.stringify([method, suffix, body])
    if (receipt.current?.signature !== signature) receipt.current = { signature, requestId: crypto.randomUUID() }
    try {
      await api[method](`rooms/${roomId}/karaoke-calls/listening-intros${suffix}`, { body: { ...body, requestId: receipt.current.requestId } })
      receipt.current = null
      if (alive.current) await refresh()
      return true
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message)
        await refresh()
      }
      return false
    } finally {
      submitting.current = false
      if (alive.current) setBusy(false)
    }
  }
  const open = (item?: ListeningTemplate, trigger?: HTMLElement) => {
    const menu = trigger?.closest('details')
    returnFocus.current = menu?.querySelector('summary') ?? trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (menu) menu.open = false
    setError('')
    setText(item?.text ?? '')
    setEditor({ item })
  }
  const close = () => {
    setEditor(null)
    requestAnimationFrame(() => {
      if (alive.current) returnFocus.current?.focus()
    })
  }
  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`}>
      <div className={styles.templateHeading}>
        <h3 id={`${id}-heading`}>Introducciones para escuchar</h3>
        <Button onClick={event => open(undefined, event.currentTarget)}>Agregar introducción</Button>
      </div>
      {error && !editor && <p className={styles.error} role='alert'>{error}</p>}
      {unavailable && templates.some(item => item.status === 'waiting') && (
        <p className={styles.warning} role='status'>
          {unavailable}
          {' '}
          <Link to='/admin/settings/audio-providers?use=calls'>Ajustes de voz</Link>
        </p>
      )}
      {!templates.length && <p className={styles.hint}>Agrega una introducción para presentar los pedidos.</p>}
      <ul className={styles.list}>
        {templates.map(item => (
          <li className={styles.item} key={item.id} data-listening-template={item.id}>
            <div className={styles.templateRow}>
              <label className={styles.switch}>
                <input
                  type='checkbox'
                  checked={item.enabled}
                  disabled={busy}
                  aria-label={`Incluir ${item.text} en rotación`}
                  onChange={event => void send('put', `/${item.id}`, { revision: item.revision, enabled: event.target.checked })}
                />
                <span translate='no'>{item.text}</span>
              </label>
              <div className={styles.actions}>
                {item.audio && <Button onClick={() => listen(item.audio!)} aria-label={`Escuchar introducción ${item.audio.text}`}>Escuchar</Button>}
                <details className={styles.templateMenu}>
                  <summary aria-label={`Opciones de ${item.text}`}>⋮</summary>
                  <div className={styles.actions}>
                    <Button disabled={busy} onClick={event => open(item, event.currentTarget)}>Editar</Button>
                    <Button disabled={busy} onClick={() => void send('put', `/${item.id}`, { revision: item.revision, archived: true })}>Archivar</Button>
                  </div>
                </details>
              </div>
            </div>
            {['queued', 'generating', 'preparing'].includes(item.status) && <p className={styles.notice} role='status'>{item.audio ? 'Preparando cambios…' : 'Preparando audio…'}</p>}
            {item.status === 'waiting' && <Button disabled={busy || !!unavailable} onClick={() => void send('post', `/${item.id}/retry`, { revision: item.revision })}>Generar audio</Button>}
            {item.error && <p className={styles.error} role='alert'>{item.error}</p>}
            {['failed', 'uncertain', 'cancelled'].includes(item.status) && <Button disabled={busy} onClick={() => void send('post', `/${item.id}/retry`, { revision: item.revision })}>Reintentar</Button>}
          </li>
        ))}
      </ul>
      {editor && (
        <Modal title={editor.item ? 'Editar introducción para escuchar' : 'Nueva introducción para escuchar'} onClose={close}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const item = editor.item
              void send(item ? 'put' : 'post', item ? `/${item.id}` : '', { text, ...(item ? { revision: item.revision } : {}) }).then((ok): void => {
                if (ok && alive.current) close()
                return undefined
              })
            }}
          >
            <label className={styles.field}>
              Texto de la introducción
              <textarea ref={textInput} value={text} onChange={event => setText(event.target.value)} rows={2} maxLength={100} required />
            </label>
            {text.trim() && (
              <p className={styles.transcript} translate='no'>
                <strong>Desde la mesa cinco,</strong>
                {' '}
                {text.trim()}
                {' '}
                <strong>Luis.</strong>
              </p>
            )}
            {error && <p className={styles.error} role='alert'>{error}</p>}
            {unavailable && (
              <p className={styles.warning} role='status'>
                {unavailable}
                {' '}
                <Link to='/admin/settings/audio-providers?use=calls'>Ajustes de voz</Link>
              </p>
            )}
            <div className={styles.actions}>
              <Button type='submit' variant='primary' disabled={busy || !!unavailable}>{busy ? 'Guardando…' : 'Generar y guardar'}</Button>
              <Button onClick={close}>Cancelar</Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
