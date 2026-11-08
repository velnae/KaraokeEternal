import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import type { PlayerDisplaySettings } from 'shared/playerDisplay'
import { displayLimits } from 'shared/playerDisplay'
import { PLAYER_LOGO_LIMITS, playerLogoImagePath, type PlayerLogoKind } from 'shared/playerLogo'
import { discardPlayerLogo, uploadPlayerLogo } from 'lib/playerLogoApi'
import { NumberControl } from './DisplayControls'
import styles from './PlayerDisplaySettings.css'

interface Props {
  logo: PlayerDisplaySettings['logo']
  hasBrandLogo: boolean
  onChange(values: Partial<PlayerDisplaySettings['logo']>): void
  onUploaded(id: string): void
  onBusy(busy: boolean): void
}

export default function LogoImageFields ({ logo, hasBrandLogo, onChange, onUploaded, onBusy }: Props) {
  const png = useRef<HTMLInputElement>(null)
  const gif = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<PlayerLogoKind | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
    }
  }, [])
  const upload = async (event: React.ChangeEvent<HTMLInputElement>, kind: PlayerLogoKind) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError('')
    if (file.type !== `image/${kind}` || file.size > (kind === 'png' ? PLAYER_LOGO_LIMITS.pngBytes : PLAYER_LOGO_LIMITS.gifBytes)) {
      setError(`Seleccione un ${kind.toUpperCase()} de hasta ${kind === 'png' ? 5 : 8} MiB.`)
      return
    }
    const controller = new AbortController()
    abort.current = controller
    onBusy(true)
    setUploading(kind)
    try {
      const image = await uploadPlayerLogo(file, kind, controller.signal)
      if (!mounted.current) {
        await discardPlayerLogo(image.id).catch(() => {})
        return
      }
      onUploaded(image.id)
      if (kind === 'png') onChange({ staticImageId: image.id, mode: !logo.staticImageId && logo.animatedImageId ? 'alternating' : logo.mode })
      else onChange({ animatedImageId: image.id, mode: !logo.animatedImageId ? logo.staticImageId ? 'alternating' : 'animated' : logo.mode })
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError((cause as Error).message || 'No se pudo subir la imagen. Vuelva a intentar.')
    } finally {
      if (mounted.current) {
        setUploading(null)
        onBusy(false)
      }
    }
  }

  return (
    <>
      <label className={styles.field}>
        Imagen del logo
        <select aria-label='Imagen del logo' value={logo.source} onChange={event => onChange({ source: event.currentTarget.value as 'brand' | 'custom' })}>
          <option value='brand'>Marca del local</option>
          <option value='custom'>Personalizada</option>
        </select>
      </label>
      {logo.source === 'brand'
        ? <Link className={styles.link} to='/admin/settings/branding'>{hasBrandLogo ? 'Cambiar logo en Marca del local' : 'Subir logo en Marca del local'}</Link>
        : (
            <>
              <div className={styles.logoUploads}>
                {(['png', 'gif'] as const).map((kind) => {
                  const id = kind === 'png' ? logo.staticImageId : logo.animatedImageId
                  const input = kind === 'png' ? png : gif
                  return (
                    <div key={kind} className={styles.logoUpload}>
                      <strong>{kind === 'png' ? 'Imagen estática (PNG)' : 'Animación (GIF)'}</strong>
                      {id && <img src={new URL(playerLogoImagePath(id, kind === 'gif'), document.baseURI).href} alt={`Vista previa ${kind.toUpperCase()}`} />}
                      <input ref={input} type='file' className={styles.srOnly} tabIndex={-1} aria-label={`Seleccionar ${kind.toUpperCase()} de pantalla`} accept={`image/${kind}`} onChange={(event) => { void upload(event, kind) }} />
                      <Button type='button' className={styles.secondary} onClick={() => input.current?.click()}>
                        {uploading === kind ? 'Preparando…' : `${id ? 'Cambiar' : 'Subir'} ${kind.toUpperCase()}`}
                      </Button>
                      {id && <Button type='button' className={styles.link} onClick={() => onChange(kind === 'png' ? { staticImageId: null } : { animatedImageId: null, mode: 'static' })}>{`Quitar ${kind.toUpperCase()}`}</Button>}
                    </div>
                  )
                })}
              </div>
              {logo.animatedImageId && (
                <label className={styles.field}>
                  Presentación del logo
                  <select aria-label='Presentación del logo' value={logo.mode} onChange={event => onChange({ mode: event.currentTarget.value as PlayerDisplaySettings['logo']['mode'] })}>
                    <option value='static'>Estática</option>
                    <option value='animated'>Animada</option>
                    <option value='alternating'>Intermitente</option>
                  </select>
                </label>
              )}
              {logo.mode === 'alternating' && (
                <>
                  <NumberControl label='Tiempo estático (s)' value={logo.staticSeconds} limit={displayLimits.logo.staticSeconds} onChange={staticSeconds => onChange({ staticSeconds })} />
                  <NumberControl label='Tiempo animado (s)' value={logo.animatedSeconds} limit={displayLimits.logo.animatedSeconds} onChange={animatedSeconds => onChange({ animatedSeconds })} />
                </>
              )}
            </>
          )}
      {error && <p role='alert' className={styles.error}>{error}</p>}
    </>
  )
}
