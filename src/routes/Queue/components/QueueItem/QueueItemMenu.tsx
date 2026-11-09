import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from 'components/Icon/Icon'
import theme from 'styles/karaokeTheme.css'
import styles from './QueueItemMenu.css'

export type QueueMenuAction = 'remove' | 'resource' | 'song' | 'artist' | 'upcoming' | 'move' | 'requeue' | 'replay' | 'skip' | 'skip-upcoming' | 'info' | 'star'

export default function QueueItemMenu ({ id, anchor, title, local, removable, movable, replayable, requeueable, skippable, infoable, blockable, starred, focusLast, onClose, onSelect }: {
  id: string
  anchor: HTMLButtonElement
  title: string
  local: boolean
  removable: boolean
  movable: boolean
  replayable: boolean
  requeueable: boolean
  skippable: boolean
  infoable: boolean
  blockable: boolean
  starred: boolean
  focusLast: boolean
  onClose: (restoreFocus?: boolean) => void
  onSelect: (action: QueueMenuAction) => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' })

  useLayoutEffect(() => {
    const place = () => {
      const element = menu.current
      if (!element || !anchor.isConnected) return onClose(false)
      const rect = anchor.getBoundingClientRect()
      const margin = 12
      const gap = 8
      if (rect.bottom < 0 || rect.top > window.innerHeight) return onClose(false)
      const below = window.innerHeight - rect.bottom - margin - gap
      const above = rect.top - margin - gap
      const height = element.scrollHeight + 2
      const upwards = below < height && above > below
      const maxHeight = Math.max(44, upwards ? above : below)
      const width = Math.min(320, window.innerWidth - margin * 2)
      setPosition({
        width,
        maxHeight,
        left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)),
        top: upwards ? Math.max(margin, rect.top - gap - Math.min(height, maxHeight)) : rect.bottom + gap,
      })
    }
    const onScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) place()
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, onClose])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      items?.[focusLast ? items.length - 1 : 0]?.focus({ preventScroll: true })
    })
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false)
    }
    const blur = (event: FocusEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', blur)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', blur)
    }
  }, [anchor, focusLast, onClose])

  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Tab') onClose()
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[index]?.focus()
    }
  }
  const item = (action: QueueMenuAction, label: string, description: string, icon: React.ComponentProps<typeof Icon>['icon']) => (
    <button type='button' role='menuitem' tabIndex={-1} className={styles.item} data-action={action} onClick={() => onSelect(action)}>
      <Icon icon={icon} size={20} />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  )

  // The portal keeps the menu outside clipped/animated queue cards.
  return createPortal(
    <div ref={menu} id={id} className={`${theme.theme} ${styles.menu}`} style={position} role='menu' aria-label={`Acciones: ${title}`} onKeyDown={keyDown}>
      {movable && item('move', 'Mover canción al inicio', 'Adelantar dentro de su turno', 'MOVE_TOP')}
      {skippable && item('skip', 'Reproducir siguiente canción', 'Terminar la canción actual', 'PLAY_NEXT')}
      {replayable && item('replay', 'Volver a reproducir canción', 'Reproducir desde el comienzo', 'REPLAY')}
      {requeueable && item('requeue', 'Volver a agregar a la cola', 'Crear un nuevo pedido', 'PLUS')}
      {local && item('star', starred ? 'Quitar de favoritas' : 'Marcar como favorita', 'Tus canciones guardadas', 'STAR_FULL')}
      {infoable && item('info', 'Información de la canción', 'Archivo y versiones disponibles', 'INFO_OUTLINE')}
      {(movable || skippable || replayable || requeueable || local || infoable) && <div role='separator' className={styles.separator} />}
      {removable && item('remove', 'Quitar de la cola', 'Solo retira este pedido', 'DELETE')}
      {removable && <div role='separator' className={styles.separator} />}
      {blockable && item('resource', local ? 'Bloquear este archivo' : 'Bloquear este video', local ? 'Solo esta canción local' : 'Solo esta versión de YouTube', 'CLEAR')}
      {blockable && item('song', 'Bloquear canción…', 'Por artista y título', 'MICROPHONE')}
      {blockable && item('artist', 'Bloquear artista…', 'Todo su repertorio', 'PERSON')}
      {blockable && removable && <div role='separator' className={styles.separator} />}
      {removable && item('upcoming', 'Quitar próximos pedidos', 'De este participante, sin bloquear su música', 'DELETE')}
      {skippable && item('skip-upcoming', 'Saltar y quitar próximos pedidos', 'De este participante, sin bloquear su música', 'PLAY_NEXT')}
    </div>,
    document.body,
  )
}
