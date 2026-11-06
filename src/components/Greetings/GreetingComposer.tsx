import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import { greetingMessageLength, greetingMessageLimit, normalizeGreetingMessage, validateGreeting, type GreetingOpportunity } from 'shared/greetings'
import styles from './Greetings.css'

export default function GreetingComposer ({ sender, opportunity, pending, busy, connected, descriptionId, noticeId, onSave }: {
  sender: string
  opportunity?: GreetingOpportunity
  pending: boolean
  busy: boolean
  connected: boolean
  descriptionId: string
  noticeId?: string
  onSave: (message: string) => Promise<{ ok: boolean, error?: string, uncertain?: boolean }>
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [saving, setSaving] = useState(false)
  const mounted = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const limit = opportunity?.maxMessageLength ?? greetingMessageLimit(sender)
  const length = greetingMessageLength(message)
  const reason = noticeId ? '' : !connected ? 'Sin conexión. Espere a reconectar.' : !pending ? 'La canción ya no admite saludos.' : opportunity?.reason ?? ''
  let validation = ''
  try {
    validateGreeting({ message: normalizeGreetingMessage(message) }, sender)
  } catch (error) { validation = (error as Error).message }
  const save = async () => {
    if (saving || busy || !connected || noticeId || (!uncertain && (!opportunity?.canAdd || !!validation))) return
    setSaving(true)
    setError('')
    const result = await onSave(normalizeGreetingMessage(message))
    if (!mounted.current) return
    setSaving(false)
    if (result.ok) {
      setOpen(false)
      setMessage('')
      setUncertain(false)
    } else {
      setError(result.uncertain ? 'Envío sin confirmar. Pulsa «Comprobar saludo».' : result.error || 'No se pudo guardar el saludo. Intente nuevamente.')
      setUncertain(!!result.uncertain)
    }
  }

  const feedback = error || reason || (message.trim() ? validation : '')
  const feedbackId = feedback ? `${id}-feedback` : undefined
  const description = [descriptionId, noticeId, feedbackId].filter(Boolean).join(' ')

  if (!open && !pending) return null
  return (
    <div className={styles.composer} data-expanded={open}>
      {!open
        ? (
            <>
              <button type='button' ref={trigger} className={styles.addGreeting} disabled={busy || !connected || !!noticeId || !opportunity?.canAdd} aria-describedby={[descriptionId, noticeId, reason ? `${id}-availability` : undefined].filter(Boolean).join(' ')} aria-expanded={false} onClick={() => setOpen(true)}>{noticeId || !connected ? 'Agregar saludo' : busy ? 'Procesando…' : !opportunity ? 'Cargando…' : 'Agregar saludo'}</button>
              {reason && <p id={`${id}-availability`} className={styles.secondary}>{reason}</p>}
            </>
          )
        : (
            <form
              className={styles.fields}
              aria-label='Agregar saludo'
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <label htmlFor={`${id}-message`}>Mensaje</label>
              <textarea
                ref={input}
                id={`${id}-message`}
                rows={3}
                value={message}
                disabled={saving || busy || uncertain}
                placeholder='Escribe tu saludo…'
                onChange={(event) => {
                  const next = event.target.value.normalize('NFC')
                  setMessage([...next].slice(0, limit).join(''))
                  setError(greetingMessageLength(next) > limit ? 'El mensaje se ajustó al límite de caracteres.' : '')
                }}
                aria-describedby={[`${id}-count`, noticeId, feedbackId].filter(Boolean).join(' ')}
                aria-invalid={!!message.trim() && !!validation}
              />
              <div className={styles.caption}>
                <span id={`${id}-count`} aria-label={`${length} de ${limit} caracteres`}>{`${length}/${limit}`}</span>
              </div>
              {feedback && <p id={feedbackId} role='alert' className={styles.notice}>{feedback}</p>}
              <div className={styles.editorActions}>
                <Button type='submit' disabled={saving || busy || !connected || !!noticeId || (!uncertain && (!opportunity?.canAdd || !!validation))} aria-describedby={description}>{saving ? 'Guardando…' : busy && connected ? 'Procesando…' : uncertain ? 'Comprobar saludo' : 'Guardar saludo'}</Button>
                <Button
                  className={styles.cancelEditor}
                  disabled={saving}
                  onClick={() => {
                    setOpen(false)
                    requestAnimationFrame(() => {
                      if (trigger.current && !trigger.current.disabled) trigger.current.focus()
                      else document.getElementById(descriptionId)?.focus()
                    })
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
    </div>
  )
}
