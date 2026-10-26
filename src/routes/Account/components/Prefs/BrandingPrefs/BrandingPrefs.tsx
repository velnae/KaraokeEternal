import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import ClientBranding from 'components/ClientBranding/ClientBranding'
import Icon from 'components/Icon/Icon'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { saveBranding } from 'store/modules/prefs'
import { defaultClientBranding, normalizeBrandingSupportUrl } from 'shared/branding'
import prepareBrandingLogo from 'lib/prepareBrandingLogo'
import styles from './BrandingPrefs.css'

const BrandingPrefs = () => {
  const branding = useAppSelector(state => state.prefs.branding)
  const dispatch = useAppDispatch()
  const [draft, setDraft] = useState(branding)
  const [dirty, setDirty] = useState(false)
  const [operation, setOperation] = useState<'image' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [supportTouched, setSupportTouched] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const supportRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const busy = operation !== null
  const hasName = Boolean(draft.name.trim())
  const supportError = normalizeBrandingSupportUrl(draft.supportUrl) === null
    ? 'Use un enlace HTTPS válido, por ejemplo https://su-sitio.com/soporte.'
    : ''

  let feedback: React.ReactNode = 'Sin cambios pendientes'
  if (status) {
    feedback = (
      <span className={styles.saved}>
        <Icon icon='CHECK' size={18} />
        {status}
      </span>
    )
  }
  if (dirty) feedback = <span className={styles.pending}>Cambios sin guardar</span>
  if (operation) feedback = operation === 'image' ? 'Preparando logo…' : 'Guardando cambios…'

  useEffect(() => {
    if (!dirty) setDraft(branding)
  }, [branding, dirty])

  const change = (values: Partial<typeof draft>) => {
    const next = { ...draft, ...values }
    setDraft(next)
    setDirty(next.name !== branding.name || next.logoSrc !== branding.logoSrc || next.supportUrl !== branding.supportUrl)
    setStatus('')
    setError('')
  }

  const chooseLogo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setOperation('image')
    setError('')
    setStatus('')
    try {
      change({ logoSrc: await prepareBrandingLogo(file) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el logo.')
    } finally {
      setOperation(null)
    }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !dirty) return
    setSupportTouched(true)
    if (supportError) {
      supportRef.current?.focus()
      return
    }
    setOperation('save')
    setError('')
    setStatus('')
    try {
      const saved = await dispatch(saveBranding(draft))
      setDraft(saved)
      setDirty(false)
      setStatus('Cambios guardados.')
    } catch (cause) {
      setError((cause as { message?: string }).message || 'No se pudo guardar la marca del cliente.')
    } finally {
      setOperation(null)
    }
  }

  return (
    <form onSubmit={save} className={styles.form} aria-labelledby={`${id}-title`} noValidate>
      <header className={styles.header}>
        <div>
          <h3 id={`${id}-title`}>Marca del cliente</h3>
          <p>La identidad que verán sus usuarios al entrar al karaoke.</p>
        </div>
        <span className={styles.currentBrand}>
          {branding.name.trim() ? 'En uso: marca del cliente' : 'En uso: marca del software'}
        </span>
      </header>

      <fieldset disabled={busy} className={styles.fields}>
        <legend className={styles.srOnly}>Configurar la marca del cliente</legend>
        <div className={styles.workspace}>
          <div className={styles.editor}>
            <div className={styles.field}>
              <label htmlFor={`${id}-name`}>Nombre del cliente</label>
              <input
                id={`${id}-name`}
                type='text'
                maxLength={100}
                placeholder='Nombre de su local o empresa'
                value={draft.name}
                aria-describedby={`${id}-name-help`}
                onChange={event => change({ name: event.currentTarget.value })}
              />
              <p id={`${id}-name-help`} className={styles.hint}>
                Aparecerá debajo de “Karaoke”, con estilo neón. Déjelo vacío para mostrar “Eternal”.
              </p>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>
                Logo
                <span>Opcional</span>
              </span>
              <div className={styles.logoPicker}>
                <div className={styles.logoThumbnail} aria-hidden='true'>
                  {draft.logoSrc
                    ? <img src={draft.logoSrc} alt='' />
                    : <Icon icon='PHOTO_ADD' size={28} />}
                </div>
                <div className={styles.logoControls}>
                  <Button
                    type='button'
                    variant='default'
                    className={styles.uploadButton}
                    aria-describedby={`${id}-logo-help`}
                    onClick={() => fileRef.current?.click()}
                  >
                    {draft.logoSrc ? 'Cambiar logo' : 'Subir logo'}
                  </Button>
                  {draft.logoSrc && (
                    <Button type='button' className={styles.textButton} onClick={() => change({ logoSrc: '' })}>
                      Quitar logo
                    </Button>
                  )}
                </div>
              </div>
              <input
                ref={fileRef}
                type='file'
                className={styles.srOnly}
                tabIndex={-1}
                aria-label='Seleccionar logo del cliente'
                accept='image/png,image/jpeg'
                onChange={chooseLogo}
              />
              <p id={`${id}-logo-help`} className={styles.hint}>PNG o JPG · Hasta 5 MB. Se mostrará centrado encima de “Karaoke”.</p>
              {!hasName && draft.logoSrc && (
                <p className={styles.notice}>
                  Agregue el nombre del cliente para mostrar este logo en el acceso.
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor={`${id}-support`} className={styles.label}>
                Enlace de soporte
                <span aria-hidden='true'>Opcional</span>
              </label>
              <input
                id={`${id}-support`}
                ref={supportRef}
                type='url'
                maxLength={2048}
                placeholder='https://su-sitio.com/soporte'
                value={draft.supportUrl}
                aria-invalid={supportTouched && Boolean(supportError)}
                aria-describedby={`${id}-support-help`}
                onBlur={() => setSupportTouched(true)}
                onChange={event => change({ supportUrl: event.currentTarget.value })}
              />
              <p id={`${id}-support-help`} className={supportTouched && supportError ? styles.fieldError : styles.hint}>
                {supportTouched && supportError ? supportError : 'Sus usuarios verán un enlace para contactar a su equipo.'}
              </p>
            </div>
          </div>

          <figure className={styles.preview}>
            <figcaption>
              <Icon icon='VISIBILITY' size={18} />
              <span>Vista previa del acceso</span>
            </figcaption>
            <div className={styles.loginPreview}>
              <ClientBranding branding={draft} className={styles.previewBrand} />
              <div className={styles.loginMock} aria-hidden='true'>
                <strong>Iniciar sesión</strong>
                <span>Nombre de usuario</span>
                <div className={styles.mockInput}>nombre de usuario</div>
                <span>Contraseña</span>
                <div className={styles.mockInput}>••••••••</div>
                <div className={styles.mockSubmit}>Entrar</div>
              </div>
            </div>
            <p className={styles.previewNote}>
              {hasName ? 'Así se verá su marca antes de iniciar sesión.' : 'Sin nombre de cliente, se mostrará Karaoke Eternal.'}
            </p>
          </figure>
        </div>

        <div className={styles.resetRow}>
          <Icon icon='INFO_OUTLINE' size={18} />
          <p>La sección Acerca de mantiene los datos y créditos del software.</p>
          <Button
            type='button'
            className={styles.textButton}
            disabled={!draft.name && !draft.logoSrc && !draft.supportUrl}
            onClick={() => {
              change({ ...defaultClientBranding })
              setSupportTouched(false)
            }}
          >
            Usar marca del software
          </Button>
        </div>
      </fieldset>

      {error && (
        <p role='alert' className={styles.error}>
          <Icon icon='ALERT_OUTLINE' size={20} />
          {error}
        </p>
      )}

      <footer className={styles.footer}>
        <div className={styles.feedback} role='status' aria-live='polite' aria-atomic='true'>
          {feedback}
        </div>
        <div className={styles.actions}>
          {dirty && (
            <Button
              type='button'
              className={styles.discardButton}
              disabled={busy}
              onClick={() => {
                setDraft(branding)
                setDirty(false)
                setError('')
                setStatus('')
                setSupportTouched(false)
              }}
            >
              Descartar
            </Button>
          )}
          <Button
            type='submit'
            variant='primary'
            className={styles.saveButton}
            disabled={busy || !dirty}
          >
            {operation === 'save' ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </footer>
    </form>
  )
}

export default BrandingPrefs
