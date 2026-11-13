import React, { useId, useLayoutEffect, useState, type RefObject } from 'react'
import { sceneCueTitle, type EventScene, type ResolvedSceneCue } from 'shared/eventScenes'
import { sceneLinks, sceneOffsetLabel, type SceneLink } from './sceneLinks'
import styles from './Scenes.css'

interface LinkPath { link: SceneLink, d: string, x: number, y: number, fromX: number, fromY: number }

export default function SceneLinks ({ scene, resolved, selectedId, container, select }: { scene: EventScene, resolved: ResolvedSceneCue[], selectedId: string | null, container: RefObject<HTMLDivElement | null>, select(id: string): void }) {
  const marker = useId().replace(/:/g, '')
  const [drawing, setDrawing] = useState<{ width: number, height: number, paths: LinkPath[] }>({ width: 0, height: 0, paths: [] })
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const measure = () => {
      const rect = root.getBoundingClientRect()
      const nodes = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-cue]')).map(node => [node.dataset.timelineCue!, node.getBoundingClientRect()]))
      const paths = sceneLinks(scene, resolved, selectedId).flatMap((link, index): LinkPath[] => {
        const from = nodes.get(link.source.id)
        const to = nodes.get(link.target.id)
        if (!from || !to) return []
        const sx = (link.edge === 'start' ? from.left : from.right) - rect.left
        const sy = from.top - rect.top
        const tx = to.left - rect.left
        const ty = to.top - rect.top
        const channel = rect.width - 12 - (index % 8) * 6
        const sameRow = Math.abs(sy - ty) < 2
        const d = sameRow ? `M ${sx} ${sy} V ${sy - 10} H ${tx} V ${ty}` : `M ${sx} ${sy} V ${sy - 10} H ${channel} V ${ty - 10} H ${tx} V ${ty}`
        return [{ link, d, x: sameRow ? (sx + tx) / 2 : Math.min(channel - 32, tx + 34), y: ty - 10, fromX: sx, fromY: sy }]
      })
      setDrawing({ width: rect.width, height: rect.height, paths })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [scene, resolved, selectedId, container])
  if (!drawing.paths.length) return null
  return (
    <svg className={styles.links} width={drawing.width} height={drawing.height} aria-label='Relaciones del bloque seleccionado'>
      <defs><marker id={marker} viewBox='0 0 10 10' refX='9' refY='5' markerWidth='6' markerHeight='6' orient='auto'><path d='M 0 0 L 10 5 L 0 10 z' fill='currentColor' /></marker></defs>
      {drawing.paths.map(({ link, d, x, y, fromX, fromY }) => (
        <g
          key={link.target.id}
          role='button'
          tabIndex={0}
          aria-label={`${sceneCueTitle(link.target)} respecto al ${link.edge === 'start' ? 'inicio' : 'final'} de ${sceneCueTitle(link.source)}, ${sceneOffsetLabel(link.offsetMs)}${link.resolved ? '' : ', sin tiempos de prueba'}`}
          data-link-from={link.source.id}
          data-link-to={link.target.id}
          data-link-edge={link.edge}
          data-link-resolved={link.resolved}
          onClick={() => select(link.target.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              select(link.target.id)
            }
          }}
        >
          <path d={d} markerEnd={`url(#${marker})`} fill='none' stroke='currentColor' strokeWidth='1.5' strokeDasharray={link.resolved ? undefined : '5 4'} />
          <circle cx={fromX} cy={fromY} r='3' fill='currentColor' />
          <rect x={x - 29} y={y - 8} width='58' height='16' rx='3' />
          <text x={x} y={y + 4} textAnchor='middle'>{sceneOffsetLabel(link.offsetMs)}</text>
        </g>
      ))}
    </svg>
  )
}
