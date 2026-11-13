import React, { useLayoutEffect, useRef } from 'react'
import { defaultSceneTextLayout, sceneCueTitle, sceneTextValue, type ResolvedSceneCue, type SceneCue, type SceneTextLayout } from 'shared/eventScenes'
import styles from './Scenes.css'

export interface SceneEditing {
  selectedId: string | null
  select(id: string): void
  change(id: string, patch: Partial<SceneCue>): void
  fit?(id: string, y: number): void
  begin(): void
  end(): void
}
function background (color: string, opacity: number) {
  return `rgba(${[1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)).join(',')},${opacity / 100})`
}
function placement (layout: SceneTextLayout): React.CSSProperties {
  return { left: `${layout.x}%`, top: `${layout.y}%`, width: `${layout.width}%`, fontSize: `${layout.fontSize / 19.2}cqw`, fontWeight: layout.weight,
    textAlign: layout.align, color: layout.color, background: background(layout.background, layout.backgroundOpacity),
    fontFamily: layout.family === 'theme' ? 'inherit' : layout.family === 'serif' ? 'serif' : 'sans-serif', textShadow: layout.shadow ? '0 2px 10px #000' : 'none' }
}
export default function SceneLayers ({ cues, elapsedMs, values, children, fill = false, editing, greeting, onGreetingMounted }: {
  cues: ResolvedSceneCue[]
  elapsedMs: number
  values: Record<string, string>
  children?: React.ReactNode
  fill?: boolean
  editing?: SceneEditing
  greeting?: { id: number, message: string, sender: string }
  onGreetingMounted?: (node: HTMLElement | null) => void
}) {
  const nodes = useRef(new Map<string, HTMLDivElement>())
  useLayoutEffect(() => {
    if (!editing?.fit) return
    for (const cue of cues) {
      const node = nodes.current.get(cue.id)
      const height = node?.parentElement?.clientHeight ?? 0
      if (!node || !height || !cue.layout) continue
      const maxY = Math.max(0, Math.min(95, 100 - (node.offsetHeight + 1) / height * 100))
      if (cue.layout.y > maxY) editing.fit(cue.id, Math.floor(maxY * 10) / 10)
    }
  }, [cues, values, editing])
  const active = cues.filter(cue => cue.lane === 'text' && ((elapsedMs >= cue.startMs && elapsedMs < cue.endMs) || editing?.selectedId === cue.id))
  const native = active.some(cue => !cue.text)
  const customGreeting = active.find(cue => cue.text.includes('{message}') && cue.text.includes('{sender}'))
  return (
    <>
      {active.map((cue) => {
        const progress = cue.fadeMs > 0 ? Math.max(0, Math.min(1, (elapsedMs - cue.startMs) / cue.fadeMs, (cue.endMs - elapsedMs) / cue.fadeMs)) : 1
        const visible = elapsedMs >= cue.startMs && elapsedMs < cue.endMs
        const style: React.CSSProperties = { ...(cue.layout ? placement(cue.layout) : {}), animation: 'none', opacity: editing ? visible ? 1 : 0.4 : cue.animation === 'none' ? 1 : progress,
          transform: !editing && cue.animation === 'slide' ? `translateY(${(1 - progress) * 12}px)` : undefined }
        return (
          <div
            key={cue.id}
            ref={(node) => {
              if (node) nodes.current.set(cue.id, node)
              else nodes.current.delete(cue.id)
              if (greeting && customGreeting?.id === cue.id) onGreetingMounted?.(node)
            }}
            data-greeting-id={greeting && customGreeting?.id === cue.id ? greeting.id : undefined}
            className={styles.caption}
            data-native={!cue.text}
            data-fill={fill && !cue.text}
            data-custom-layout={!!cue.layout}
            data-position={cue.position}
            data-editable={!!editing}
            data-selected={editing?.selectedId === cue.id}
            data-scene-cue={cue.id}
            style={style}
            role={editing ? 'button' : undefined}
            tabIndex={editing ? 0 : undefined}
            aria-label={editing ? `Editar ${sceneCueTitle(cue)}` : undefined}
            onClick={editing ? () => editing.select(cue.id) : undefined}
            onKeyDown={editing && cue.layout
              ? (event) => {
                  const delta = event.shiftKey ? 1 : 0.1
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                  event.preventDefault()
                  const layout = cue.layout!
                  editing.change(cue.id, { layout: { ...layout, x: Math.max(0, Math.min(100 - layout.width, layout.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0))),
                    y: Math.max(0, Math.min(95, layout.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0))) } })
                }
              : undefined}
            onPointerDown={editing
              ? (event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  editing.select(cue.id)
                  if (!cue.layout) return
                  event.preventDefault()
                  const node = event.currentTarget
                  const rect = (node.offsetParent ?? node.parentElement)!.getBoundingClientRect()
                  const start = { x: event.clientX, y: event.clientY }
                  const layout = { ...defaultSceneTextLayout(), ...cue.layout }
                  const resize = !!(event.target as HTMLElement).closest('[data-resize-text]')
                  const height = node.getBoundingClientRect().height / rect.height * 100
                  editing.begin()
                  node.setPointerCapture(event.pointerId)
                  const move = (event: PointerEvent) => {
                    const dx = (event.clientX - start.x) / rect.width * 100
                    const dy = (event.clientY - start.y) / rect.height * 100
                    editing.change(cue.id, { layout: resize
                      ? { ...layout, width: Math.max(5, Math.min(100 - layout.x, layout.width + dx)) }
                      : { ...layout, x: Math.max(0, Math.min(100 - layout.width, layout.x + dx)), y: Math.max(0, Math.min(Math.min(95, 100 - height), layout.y + dy)) } })
                  }
                  const end = () => {
                    node.removeEventListener('pointermove', move)
                    node.removeEventListener('pointerup', end)
                    node.removeEventListener('pointercancel', end)
                    editing.end()
                  }
                  node.addEventListener('pointermove', move)
                  node.addEventListener('pointerup', end)
                  node.addEventListener('pointercancel', end)
                }
              : undefined}
          >
            {cue.text ? sceneTextValue(cue.text, values) : children}
            {editing?.selectedId === cue.id && cue.layout && <span data-resize-text className={styles.textHandle} aria-hidden='true' />}
          </div>
        )
      })}
      {greeting && !native && !customGreeting && (
        <section className={styles.greetingFallback} ref={onGreetingMounted} data-greeting-id={greeting.id} role='status' data-testid='greeting-overlay'>
          <p>{greeting.message}</p>
          <footer>
            De
            {greeting.sender}
          </footer>
        </section>
      )}
    </>
  )
}
