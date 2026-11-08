import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import InputCheckbox from 'components/InputCheckbox/InputCheckbox'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { savePlayerDisplay } from 'store/modules/prefs'
import {
  DISPLAY_ANCHORS, DISPLAY_CORNERS, displayLimits, MAX_DISPLAY_MESSAGES, MAX_DISPLAY_TEXT, MAX_DISPLAY_TITLE,
  resetDisplayAppearance, SOFT_BROWN_DISPLAY_COLOR, validatePlayerDisplay, type PlayerDisplaySettings as Settings,
} from 'shared/playerDisplay'
import { ColorControl, NumberControl } from './DisplayControls'
import DisplayPreview from './DisplayPreview'
import LogoImageFields from './LogoImageFields'
import { discardPlayerLogo } from 'lib/playerLogoApi'
import styles from './PlayerDisplaySettings.css'

const positionLabels = {
  'top-left': 'Superior izquierda', 'top-center': 'Superior centro', 'top-right': 'Superior derecha',
  'bottom-left': 'Inferior izquierda', 'bottom-center': 'Inferior centro', 'bottom-right': 'Inferior derecha',
}

export default function PlayerDisplaySettings () {
  const saved = useAppSelector(state => state.prefs.playerDisplay)
  const branding = useAppSelector(state => state.prefs.branding)
  const dispatch = useAppDispatch()
  const [draft, setDraft] = useState<Settings | null>(null)
  const [tab, setTab] = useState('logo')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const staged = useRef(new Set<string>())
  useEffect(() => {
    const resources = staged.current
    return () => {
      for (const id of resources) void discardPlayerLogo(id).catch(() => {})
      resources.clear()
    }
  }, [])
  const discardUploads = (keep: (string | null)[] = []) => {
    for (const id of staged.current) if (!keep.includes(id)) void discardPlayerLogo(id).catch(() => {})
    staged.current.clear()
  }
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const id = useId()
  const settings = draft ?? saved
  const dirty = draft !== null
  const { logo, announcement: a } = settings
  const change = (next: Settings) => {
    setDraft(JSON.stringify(next) === JSON.stringify(saved) ? null : next)
    setError('')
    setStatus('')
  }
  const changeLogo = (values: Partial<Settings['logo']>) => change({ ...settings, logo: { ...logo, ...values } })
  const changeAnnouncement = (values: Partial<Settings['announcement']>) => change({ ...settings, announcement: { ...a, ...values } })
  const message = (index: number, values: Partial<Settings['announcement']['messages'][number]>) => {
    changeAnnouncement({ messages: a.messages.map((item, position) => position === index ? { ...item, ...values } : item) })
  }
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || uploading || !dirty) return
    let value: Settings
    try {
      value = validatePlayerDisplay(settings)
    } catch (cause) {
      setError((cause as Error).message)
      if ((cause as { field?: string }).field === 'logo') setTab('logo')
      const invalid = event.currentTarget.querySelector<HTMLInputElement>('input:invalid')
        ?? Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('[data-message-title]')).find(input => !input.value.trim())
      if (invalid) {
        setTab(invalid.closest<HTMLElement>('[data-section]')!.dataset.section!)
        const details = invalid.closest('details')
        if (details) details.open = true
        requestAnimationFrame(() => invalid.focus())
      }
      return
    }
    setBusy(true)
    setError('')
    try {
      await dispatch(savePlayerDisplay(value))
      discardUploads([value.logo.staticImageId, value.logo.animatedImageId])
      setDraft(null)
      setStatus('Cambios guardados.')
    } catch (cause) {
      setError((cause as { message?: string }).message || 'No se pudo guardar. Vuelva a intentarlo.')
    } finally { setBusy(false) }
  }

  return (
    <form className={styles.form} onSubmit={save} aria-label='Configuración de pantalla' noValidate>
      <DisplayPreview branding={branding} settings={settings} />
      <fieldset disabled={busy || uploading} className={styles.controls}>
        <legend className={styles.srOnly}>Elementos de pantalla</legend>
        <div className={styles.tabs} role='group' aria-label='Ajustes de pantalla'>
          {([['logo', 'Logo'], ['announcement', 'Comunicados'], ['appearance', 'Apariencia']] as const).map(([key, label]) => (
            <button key={key} type='button' aria-pressed={tab === key} aria-controls={`${id}-${key}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <section id={`${id}-logo`} data-section='logo' hidden={tab !== 'logo'}>
          <InputCheckbox label='Mostrar logo en el reproductor' checked={logo.enabled} onChange={event => changeLogo({ enabled: event.currentTarget.checked })} />
          <LogoImageFields logo={logo} hasBrandLogo={!!branding.logoSrc} onChange={changeLogo} onUploaded={id => staged.current.add(id)} onBusy={setUploading} />
          <NumberControl label='Tamaño del logo (%)' value={logo.scale} limit={displayLimits.logo.scale} onChange={scale => changeLogo({ scale })} />
          <label className={styles.field}>
            Posición del logo
            <select aria-label='Posición del logo' value={logo.position} onChange={event => changeLogo({ position: event.currentTarget.value as Settings['logo']['position'] })}>
              {DISPLAY_CORNERS.map(position => <option key={position} value={position}>{positionLabels[position]}</option>)}
            </select>
          </label>
          <NumberControl label='Margen lateral del logo (%)' value={logo.marginX} limit={displayLimits.logo.marginX} onChange={marginX => changeLogo({ marginX })} />
          <NumberControl label='Margen vertical del logo (%)' value={logo.marginY} limit={displayLimits.logo.marginY} onChange={marginY => changeLogo({ marginY })} />
          <NumberControl label='Opacidad del logo (%)' value={logo.opacity} limit={displayLimits.logo.opacity} onChange={opacity => changeLogo({ opacity })} />
        </section>
        <section id={`${id}-announcement`} data-section='announcement' hidden={tab !== 'announcement'}>
          <InputCheckbox label='Mostrar comunicados durante música para escuchar' checked={a.enabled} onChange={event => changeAnnouncement({ enabled: event.currentTarget.checked })} />
          <NumberControl label='Ancho del comunicado (%)' value={a.width} limit={displayLimits.announcement.width} onChange={width => changeAnnouncement({ width })} />
          <label className={styles.field}>
            Posición del comunicado
            <select aria-label='Posición del comunicado' value={a.position} onChange={event => changeAnnouncement({ position: event.currentTarget.value as Settings['announcement']['position'] })}>
              {DISPLAY_ANCHORS.map(position => <option key={position} value={position}>{positionLabels[position]}</option>)}
            </select>
          </label>
          <NumberControl label='Desplazamiento horizontal (%)' value={a.offsetX} limit={displayLimits.announcement.offsetX} onChange={offsetX => changeAnnouncement({ offsetX })} />
          <NumberControl label='Margen vertical del comunicado (%)' value={a.marginY} limit={displayLimits.announcement.marginY} onChange={marginY => changeAnnouncement({ marginY })} />
          <NumberControl label='Espacio interior (FHD)' value={a.padding} limit={displayLimits.announcement.padding} onChange={padding => changeAnnouncement({ padding })} />
          <NumberControl label='Intervalo entre mensajes (s)' value={a.intervalSeconds} limit={displayLimits.announcement.intervalSeconds} onChange={intervalSeconds => changeAnnouncement({ intervalSeconds })} />
          {a.messages.map((item, index) => (
            <fieldset key={index} className={styles.messageFields}>
              <legend>{`Comunicado ${index + 1}`}</legend>
              <label className={styles.field}>
                {`Título del comunicado ${index + 1}`}
                <input type='text' data-message-title required maxLength={MAX_DISPLAY_TITLE} value={item.title} onChange={event => message(index, { title: event.currentTarget.value })} />
              </label>
              <label className={styles.field}>
                {`Texto del comunicado ${index + 1} (opcional)`}
                <input type='text' maxLength={MAX_DISPLAY_TEXT} value={item.text} onChange={event => message(index, { text: event.currentTarget.value })} />
              </label>
              {a.messages.length > 1 && <Button type='button' className={styles.link} aria-label={`Quitar comunicado ${index + 1}`} onClick={() => changeAnnouncement({ messages: a.messages.filter((_, position) => position !== index) })}>Quitar comunicado</Button>}
            </fieldset>
          ))}
          {a.messages.length < MAX_DISPLAY_MESSAGES && <Button type='button' className={styles.secondary} onClick={() => changeAnnouncement({ messages: [...a.messages, { title: '', text: '' }] })}>Agregar comunicado</Button>}
        </section>
        <section id={`${id}-appearance`} data-section='appearance' hidden={tab !== 'appearance'}>
          <label className={styles.field}>
            Alineación del contenido
            <select aria-label='Alineación del contenido' value={a.alignment} onChange={event => changeAnnouncement({ alignment: event.currentTarget.value as 'left' | 'center' })}>
              <option value='left'>Izquierda</option>
              <option value='center'>Centrado</option>
            </select>
          </label>
          <NumberControl label='Tamaño del texto (%)' value={a.textScale} limit={displayLimits.announcement.textScale} onChange={textScale => changeAnnouncement({ textScale })} />
          <InputCheckbox label='Color de texto automático' checked={a.textColor === null} onChange={event => changeAnnouncement({ textColor: event.currentTarget.checked ? null : '#f4f7ff' })} />
          {a.textColor !== null && <ColorControl label='Color del texto' value={a.textColor} onChange={textColor => changeAnnouncement({ textColor })} />}
          <InputCheckbox label='Mostrar icono QR' checked={a.showIcon} onChange={event => changeAnnouncement({ showIcon: event.currentTarget.checked })} />
          <ColorControl label='Color de fondo del comunicado' value={a.backgroundColor} onChange={backgroundColor => changeAnnouncement({ backgroundColor })} />
          <Button type='button' className={styles.link} onClick={() => changeAnnouncement({ backgroundColor: SOFT_BROWN_DISPLAY_COLOR })}>Usar marrón suave</Button>
          <NumberControl label='Opacidad del fondo (%)' value={a.backgroundOpacity} limit={displayLimits.announcement.backgroundOpacity} onChange={backgroundOpacity => changeAnnouncement({ backgroundOpacity })} />
          <details className={styles.details}>
            <summary>Borde y sombra</summary>
            <NumberControl label='Grosor del borde (FHD)' value={a.borderWidth} limit={displayLimits.announcement.borderWidth} onChange={borderWidth => changeAnnouncement({ borderWidth })} />
            <ColorControl label='Color del borde' value={a.borderColor} onChange={borderColor => changeAnnouncement({ borderColor })} />
            <NumberControl label='Redondeado de esquinas (FHD)' value={a.borderRadius} limit={displayLimits.announcement.borderRadius} onChange={borderRadius => changeAnnouncement({ borderRadius })} />
            <InputCheckbox label='Mostrar sombra' checked={a.shadow} onChange={event => changeAnnouncement({ shadow: event.currentTarget.checked })} />
          </details>
        </section>
      </fieldset>
      <footer className={styles.footer}>
        <div>
          <p role='status'>{uploading ? 'Preparando imagen…' : busy ? 'Guardando…' : dirty ? 'Cambios sin guardar' : status || 'Sin cambios pendientes'}</p>
          {error && <p role='alert' className={styles.error}>{error}</p>}
        </div>
        <div className={styles.actions}>
          <Button type='button' className={styles.link} disabled={busy || uploading} onClick={() => change(resetDisplayAppearance(settings))}>Restablecer apariencia</Button>
          {dirty && (
            <Button
              type='button'
              className={styles.secondary}
              disabled={busy || uploading}
              onClick={() => {
                discardUploads()
                setDraft(null)
                setError('')
                setStatus('')
              }}
            >
              Descartar
            </Button>
          )}
          <Button type='submit' variant='primary' className={styles.apply} disabled={busy || uploading || !dirty}>Aplicar cambios</Button>
        </div>
      </footer>
    </form>
  )
}
