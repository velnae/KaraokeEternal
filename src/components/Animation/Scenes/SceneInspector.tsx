import React, { useRef } from 'react'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import { defaultSceneTextLayout, sceneCueTitle, type EventScene, type SceneCue, type SceneTextLayout } from 'shared/eventScenes'
import type { AnimationClip } from 'shared/animation'
import type { TransitionVideo } from 'shared/transitionVideo'
import SceneNumber from './SceneNumber'
import SceneIconButton from './SceneIconButton'
import styles from './Scenes.css'

export default function SceneInspector ({ scene, cue, audio, videos, sample, change, replace, duplicate, remove, split, move, setSample }: {
  scene: EventScene
  cue: SceneCue
  audio: AnimationClip[]
  videos: TransitionVideo[]
  sample: string
  change(patch: Partial<SceneCue>): void
  replace(): void
  duplicate(): void
  remove(): void
  split(): void
  move(direction: number): void
  setSample(id: string): void
}) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const blockActions = useRef<HTMLDetailsElement>(null)
  const closeActions = () => {
    if (!blockActions.current) return
    blockActions.current.open = false
    blockActions.current.querySelector('summary')?.focus()
  }
  const protectedAudio = cue.lane === 'voice' && cue.binding !== 'resource' && (scene.event !== 'transition' || ['greeting', 'signature'].includes(cue.slot))
  const layout = cue.layout ?? defaultSceneTextLayout()
  const format = (patch: Partial<SceneTextLayout>) => change({ layout: { ...layout, ...patch } })
  const compatible = cue.lane === 'background' ? videos : audio.filter(clip => cue.lane === 'ambience' ? clip.kind === 'ambience' : clip.kind !== 'ambience')
  return (
    <section aria-label='Propiedades del elemento' className={styles.properties}>
      <h3>{sceneCueTitle(cue)}</h3>
      <details className={styles.propertyGroup} open>
        <summary>Contenido</summary>
        <div>
          <label>
            Nombre del elemento
            <input type='text' value={cue.label ?? ''} maxLength={80} placeholder={sceneCueTitle(cue)} onChange={e => change({ label: e.target.value })} />
          </label>
          {!protectedAudio && (
            <div className={styles.actions}>
              <SceneIconButton label='Duplicar elemento' icon='COPY' onClick={duplicate} />
              <SceneIconButton label='Quitar de la escena' icon='DELETE' onClick={remove} />
              {cue.binding === 'resource' && cue.lane === 'voice' && (
                <details
                  className={styles.blockActions}
                  ref={blockActions}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeActions()
                    }
                  }}
                >
                  <summary className={styles.iconDisclosure} aria-label='Más acciones del bloque'><Icon icon='MORE_HORIZ' size={22} /></summary>
                  <div className={styles.actionMenu}>
                    <Button
                      variant='default'
                      onClick={() => {
                        move(-1)
                        closeActions()
                      }}
                    >
                      Mover antes
                    </Button>
                    <Button
                      variant='default'
                      onClick={() => {
                        move(1)
                        closeActions()
                      }}
                    >
                      Mover después
                    </Button>
                  </div>
                </details>
              )}
            </div>
          )}
          {!protectedAudio && (
            <label className={styles.check}>
              <input type='checkbox' checked={cue.enabled !== false} onChange={e => change({ enabled: e.target.checked })} />
              Activo
            </label>
          )}
          {cue.lane !== 'text' && (!protectedAudio || cue.slot === 'intro' || cue.slot === 'music' || (cue.slot === 'announcement' && scene.event === 'transition')) && (
            <>
              <label>
                Recurso
                <select value={cue.resourceId ?? ''} onChange={e => change({ resourceId: e.target.value || null })}>
                  {cue.binding !== 'resource' && <option value=''>Del evento</option>}
                  {compatible.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
              <Button variant='default' onClick={replace}>Reemplazar recurso</Button>
            </>
          )}
          {cue.lane === 'voice' && !cue.resourceId && (
            <label>
              Audio de prueba
              <select value={sample} onChange={e => setSample(e.target.value)}>
                <option value=''>Seleccionar muestra</option>
                {audio.filter(clip => clip.kind !== 'ambience').map(clip => <option key={clip.id} value={clip.id}>{clip.title}</option>)}
              </select>
            </label>
          )}
          {cue.lane === 'text' && !cue.text && !cue.layout && <Button variant='primary' onClick={split}>Separar datos para editar</Button>}
          {cue.lane === 'text' && (cue.text || cue.layout) && (
            <>
              <label>
                Texto
                <textarea ref={textarea} rows={3} value={cue.text} maxLength={300} onChange={e => change({ text: e.target.value })} />
              </label>
              <label>
                Insertar dato
                <select
                  value=''
                  onChange={(e) => {
                    if (!e.target.value) return
                    const node = textarea.current!
                    const start = node.selectionStart
                    const end = node.selectionEnd
                    const value = `{${e.target.value}}`
                    change({ text: `${cue.text.slice(0, start)}${value}${cue.text.slice(end)}` })
                    requestAnimationFrame(() => {
                      node.focus()
                      node.setSelectionRange(start + value.length, start + value.length)
                    })
                  }}
                >
                  <option value=''>Seleccionar dato</option>
                  <option value='name'>Nombre</option>
                  <option value='table'>Mesa</option>
                  <option value='song'>Canción</option>
                  <option value='venue'>Local</option>
                  <option value='message'>Saludo</option>
                  <option value='sender'>Remitente</option>
                </select>
              </label>
            </>
          )}
        </div>
      </details>
      {cue.lane === 'text' && (cue.text || cue.layout) && (
        <details className={styles.propertyGroup}>
          <summary>Formato</summary>
          <div>
            <SceneNumber label='Tamaño del texto (FHD)' value={layout.fontSize} min={12} max={240} onChange={fontSize => format({ fontSize })} />
            <label className={styles.check}>
              <input type='checkbox' checked={layout.weight === 700} onChange={e => format({ weight: e.target.checked ? 700 : 400 })} />
              Negrita
            </label>
            <label>
              Alineación
              <select value={layout.align} onChange={e => format({ align: e.target.value as SceneTextLayout['align'] })}>
                <option value='left'>Izquierda</option>
                <option value='center'>Centro</option>
                <option value='right'>Derecha</option>
              </select>
            </label>
            <label>
              Fuente
              <select value={layout.family} onChange={e => format({ family: e.target.value as SceneTextLayout['family'] })}>
                <option value='theme'>Del karaoke</option>
                <option value='sans'>Sans serif</option>
                <option value='serif'>Serif</option>
              </select>
            </label>
            <div className={styles.numberGrid}>
              <label>
                Color del texto
                <input type='color' value={layout.color} onChange={e => format({ color: e.target.value })} />
              </label>
              <label>
                Color de fondo
                <input type='color' value={layout.background} onChange={e => format({ background: e.target.value })} />
              </label>
            </div>
            <SceneNumber label='Opacidad del fondo (%)' value={layout.backgroundOpacity} min={0} max={100} onChange={backgroundOpacity => format({ backgroundOpacity })} />
            <label className={styles.check}>
              <input type='checkbox' checked={layout.shadow} onChange={e => format({ shadow: e.target.checked })} />
              Sombra del texto
            </label>
          </div>
        </details>
      )}
      <details className={styles.propertyGroup}>
        <summary>Posición y animación</summary>
        <div>
          {cue.lane === 'text' && (cue.text || cue.layout) && (
            <div className={styles.numberGrid}>
              <SceneNumber label='Posición X (%)' value={layout.x} min={0} max={100 - layout.width} step={0.1} onChange={x => format({ x: Math.max(0, Math.min(100 - layout.width, x)) })} />
              <SceneNumber label='Posición Y (%)' value={layout.y} min={0} max={95} step={0.1} onChange={y => format({ y: Math.max(0, Math.min(95, y)) })} />
              <SceneNumber label='Ancho (%)' value={layout.width} min={5} max={100 - layout.x} onChange={width => format({ width: Math.max(5, Math.min(100 - layout.x, width)) })} />
            </div>
          )}
          {['voice', 'ambience'].includes(cue.lane) && <SceneNumber label='Volumen del bloque (%)' value={cue.volume * 100} min={0} max={100} onChange={value => change({ volume: value / 100 })} />}
          {['text', 'background'].includes(cue.lane) && (
            <label>
              Animación
              <select value={cue.animation} onChange={e => change({ animation: e.target.value as SceneCue['animation'] })}>
                <option value='fade'>Desvanecer</option>
                <option value='slide'>Deslizar</option>
                <option value='none'>Sin animación</option>
              </select>
            </label>
          )}
          <SceneNumber label='Fundido / animación (s)' value={cue.fadeMs / 1000} min={0} max={3} step={0.1} onChange={value => change({ fadeMs: value * 1000 })} />
        </div>
      </details>
    </section>
  )
}
