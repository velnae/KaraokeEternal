import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { createPortal } from 'react-dom'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { avatarAsset, avatarGroups, defaultAvatar, type AvatarEntry } from 'shared/avatars'
import HttpApi from 'lib/HttpApi'
import styles from './AvatarPicker.css'

const api = new HttpApi()
const catalogImages = new Map<string, HTMLImageElement>()

function preloadCatalog (entries: AvatarEntry[]) {
  for (const url of catalogImages.keys()) {
    if (!entries.some(entry => entry.url === url)) catalogImages.delete(url)
  }
  for (const { url } of entries) {
    if (catalogImages.has(url)) continue
    const image = new Image()
    image.fetchPriority = 'low'
    image.decoding = 'async'
    image.onerror = () => catalogImages.delete(url)
    catalogImages.set(url, image)
    image.src = new URL(url, document.baseURI).href
  }
}

export default function AvatarPicker ({ value, legacyImage, onSelect, tall }: { value: string | null, legacyImage?: React.ReactNode, onSelect: (id: string) => void, tall?: boolean }) {
  const [open, setOpen] = useState(false)
  const [group, setGroup] = useState(0)
  const [catalog, setCatalog] = useState<AvatarEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [retry, setRetry] = useState(0)
  const trigger = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const entries = await api.get<AvatarEntry[]>('avatars')
        if (!active) return
        setCatalog(entries)
        setStatus('ready')
      } catch {
        if (active) setStatus('failed')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [retry])

  useEffect(() => {
    if (!catalog.length) return
    const preload = () => preloadCatalog(catalog)
    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(preload, { timeout: 1500 })
      return () => window.cancelIdleCallback(idle)
    }

    const timer = window.setTimeout(preload, 250)
    return () => window.clearTimeout(timer)
  }, [catalog])

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.querySelector('button')?.focus())
  }
  const choose = (id: string) => {
    onSelect(id)
    close()
  }
  const preview = (url: string) => <img src={new URL(url, document.baseURI).href} alt='' width={48} height={48} />
  const selected = catalog.find(entry => entry.id === value)
  const genericUrl = catalog.find(entry => entry.id === defaultAvatar)?.url ?? avatarAsset(defaultAvatar)
  const options = catalog.filter(entry => entry.category === avatarGroups[group].id)

  return (
    <span className={clsx(styles.trigger, tall && styles.tall)} ref={trigger}>
      <Button
        className={styles.tile}
        aria-label='Elegir avatar'
        aria-haspopup='dialog'
        onClick={() => {
          setGroup(selected?.category === 'mujer' || value?.startsWith('mujer/') ? 1 : 0)
          setOpen(true)
          if (status === 'failed') {
            setStatus('loading')
            setRetry(value => value + 1)
          }
        }}
      >
        {selected ? preview(selected.url) : legacyImage ?? preview(genericUrl)}
      </Button>
      {open && createPortal((
        <Modal className={styles.dialog} title='Elegir avatar' onClose={close} scrollable>
          <div className={styles.groups} role='group' aria-label='Categoría de avatares'>
            {avatarGroups.map(({ id, label }, index) => (
              <Button key={id} aria-pressed={index === group} onClick={() => setGroup(index)}>{label}</Button>
            ))}
          </div>
          {status === 'loading' && <p role='status'>Cargando avatares…</p>}
          {status === 'failed' && <p role='alert'>No se pudo cargar el catálogo. Cierre el selector y vuelva a abrirlo.</p>}
          {status === 'ready' && !options.length && <p>No hay avatares disponibles en esta categoría.</p>}
          <div className={styles.grid} role='group' aria-label={avatarGroups[group].label}>
            {options.map(({ id, url }) => (
              <Button key={id} className={styles.tile} aria-label={`Avatar ${avatarGroups[group].label.toLowerCase()} ${Number(id.split('/')[1])}`} aria-pressed={value === id} onClick={() => choose(id)}>
                {preview(url)}
              </Button>
            ))}
          </div>
          <Button className={styles.reset} onClick={() => choose(defaultAvatar)}>Usar avatar genérico</Button>
        </Modal>
      ), document.body)}
    </span>
  )
}
