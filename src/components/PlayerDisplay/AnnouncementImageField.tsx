import React, { useEffect, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import { PLAYER_LOGO_LIMITS } from 'shared/playerLogo'
import { discardPlayerLogo, uploadPlayerLogo } from 'lib/playerLogoApi'
import { announcementImageSource } from './announcementImage'
import { ANNOUNCEMENT_IMAGE_SCALE_LIMIT } from 'shared/playerDisplay'
import { NumberControl } from './DisplayControls'
import styles from './PlayerDisplaySettings.css'

interface Props {
  image?: string | null
  number: number
  imageScale?: number
  onScaleChange(value: number): void
  onChange(image: string | null): void
  onUploaded(id: string): void
  onBusy(busy: boolean): void
}

export default function AnnouncementImageField ({ image, number, imageScale = 100, onScaleChange, onChange, onUploaded, onBusy }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      abort.current?.abort()
    }
  }, [])
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError('')
    if (file.type !== 'image/png' || file.size > PLAYER_LOGO_LIMITS.pngBytes) {
      setError('Seleccione un PNG de hasta 5 MiB.')
      return
    }
    const controller = new AbortController()
    abort.current = controller
    setUploading(true)
    onBusy(true)
    try {
      const uploaded = await uploadPlayerLogo(file, 'png', controller.signal)
      if (!mounted.current) {
        await discardPlayerLogo(uploaded.id).catch(() => {})
        return
      }
      onUploaded(uploaded.id)
      onChange(uploaded.id)
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError((cause as Error).message || 'No se pudo subir la imagen. Vuelva a intentar.')
    } finally {
      if (mounted.current) {
        setUploading(false)
        onBusy(false)
      }
    }
  }
  return (
    <div className={styles.logoUpload}>
      {image && <img src={announcementImageSource(image)} alt={`Imagen del comunicado ${number}`} />}
      {image && <NumberControl label={`Tamaño de imagen del comunicado ${number} (%)`} value={imageScale} limit={ANNOUNCEMENT_IMAGE_SCALE_LIMIT} onChange={onScaleChange} />}
      <input ref={input} type='file' className={styles.srOnly} tabIndex={-1} aria-label={`Seleccionar PNG del comunicado ${number}`} accept='image/png' onChange={(event) => { void upload(event) }} />
      <Button type='button' className={styles.secondary} onClick={() => input.current?.click()}>
        {uploading ? 'Preparando imagen…' : image ? 'Cambiar imagen PNG' : 'Subir imagen PNG'}
      </Button>
      {image && <Button type='button' className={styles.link} onClick={() => onChange(null)}>Quitar imagen</Button>}
      {error && <p role='alert' className={styles.error}>{error}</p>}
    </div>
  )
}
