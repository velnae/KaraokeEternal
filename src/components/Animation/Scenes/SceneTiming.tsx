import React, { useState } from 'react'
import { sceneCueTitle, type EventScene, type SceneCue } from 'shared/eventScenes'
import SceneNumber from './SceneNumber'
import styles from './Scenes.css'

export default function SceneTiming ({ scene, cue, resolved, change }: { scene: EventScene, cue?: SceneCue, resolved: boolean, change(patch: Partial<SceneCue>): void }) {
  const [beforeZero, setBeforeZero] = useState(false)
  if (!cue) return <section className={styles.timing} aria-label='Tiempo del bloque'><p>Seleccione un bloque para ajustar su tiempo y ver sus relaciones.</p></section>
  const before = cue.offsetMs === 0 ? beforeZero : cue.offsetMs < 0
  const target = scene.cues.find(item => item.id === cue.referenceId)
  return (
    <section className={styles.timing} aria-label='Tiempo del bloque'>
      <h3>{sceneCueTitle(cue)}</h3>
      <div className={styles.timingFields}>
        <span>Comenzar</span>
        <SceneNumber hideLabel label='Desplazamiento (s)' value={Math.abs(cue.offsetMs) / 1000} min={0} max={30} step={0.1} onChange={value => change({ offsetMs: Math.max(0, Math.min(30, value)) * 1000 * (cue.anchor === 'block' && before ? -1 : 1) })} />
        <span>s</span>
        {cue.anchor === 'block'
          ? (
              <>
                <select
                  aria-label='Desplazamiento'
                  value={before ? 'before' : 'after'}
                  onChange={(e) => {
                    const before = e.target.value === 'before'
                    setBeforeZero(before)
                    change({ offsetMs: Math.abs(cue.offsetMs) * (before ? -1 : 1) })
                  }}
                >
                  <option value='before'>Antes</option>
                  <option value='after'>Después</option>
                </select>
                <span>del</span>
                <select aria-label='Momento del bloque' value={cue.referenceEdge ?? 'start'} onChange={e => change({ referenceEdge: e.target.value as 'start' | 'end' })}>
                  <option value='start'>Inicio</option>
                  <option value='end'>Final</option>
                </select>
                <span>de</span>
              </>
            )
          : <span>después de</span>}
        <label>
          <select
            aria-label='Referencia'
            value={cue.anchor === 'block' ? `block:${cue.referenceId ?? ''}` : cue.anchor}
            onChange={(e) => {
              const value = e.target.value
              if (value.startsWith('block:')) {
                const referenceId = value.slice(6)
                const target = scene.cues.find(item => item.id === referenceId)!
                change({ anchor: 'block', referenceId, referenceEdge: cue.anchor === 'block' ? cue.referenceEdge : target.lane === 'voice' || target.durationMs !== null ? 'end' : 'start' })
              } else change({ anchor: value as SceneCue['anchor'], referenceId: undefined, referenceEdge: undefined, offsetMs: Math.abs(cue.offsetMs) })
            }}
          >
            <optgroup label='Escena'>
              <option value='start'>Inicio de la plantilla</option>
              <option value='mediaEnd'>Final del video</option>
              <option value='previous'>Audio anterior disponible</option>
            </optgroup>
            <optgroup label='Bloques'>
              {scene.cues.map((item, index) => item.id !== cue.id && <option key={item.id} value={`block:${item.id}`}>{`${index + 1}. ${sceneCueTitle(item)}`}</option>)}
            </optgroup>
          </select>
        </label>
        {cue.lane !== 'voice' && (
          <label>
            Duración (s)
            <input type='number' min={0.1} max={360} step={0.1} placeholder='Hasta el final' value={cue.durationMs === null ? '' : cue.durationMs / 1000} onChange={(e) => { if (e.target.value === '' || Number.isFinite(e.target.valueAsNumber)) change({ durationMs: e.target.value === '' ? null : e.target.valueAsNumber * 1000 }) }} />
          </label>
        )}
      </div>
      {target?.enabled === false
        ? <p role='status'>El bloque de referencia está inactivo. Actívelo para incluir este elemento.</p>
        : !resolved && cue.enabled !== false && <p role='status'>Seleccione un caso de prueba o complete las muestras para ver los tiempos de este bloque.</p>}
    </section>
  )
}
