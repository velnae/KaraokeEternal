import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventSceneSettings, SceneEvent } from 'shared/eventScenes'

type Selection = { event: SceneEvent, templateId: string }
type Snapshot = Selection & { value: EventSceneSettings | null }
type State = Snapshot & { saved: EventSceneSettings | null, past: Snapshot[], future: Snapshot[] }
const drafts = new Map<string, State>()
const changed = (state: State) => !!state.value && JSON.stringify(state.value) !== JSON.stringify(state.saved)
const snapshot = ({ value, event, templateId }: Snapshot): Snapshot => ({ value, event, templateId })
const resetState = (state: State, value: EventSceneSettings): State => ({ ...state, value, saved: value, past: [], future: [], templateId: value.templates.some(item => item.id === state.templateId && item.event === state.event) ? state.templateId : value.templates.find(item => item.event === state.event)?.id ?? '' })

export default function useSceneHistory (key: string) {
  const [state, setState] = useState<State>(() => drafts.get(key) ?? { value: null, saved: null, event: 'listen', templateId: 'listen', past: [], future: [] })
  const gesture = useRef<Snapshot | null>(null)
  useEffect(() => {
    if (changed(state)) drafts.set(key, state)
    else drafts.delete(key)
  }, [key, state])
  const reset = useCallback((value: EventSceneSettings) => {
    gesture.current = null
    setState(state => resetState(state, value))
  }, [])
  const load = useCallback((value: EventSceneSettings) => {
    setState(state => changed(state) ? state : resetState(state, value))
  }, [])
  const edit = useCallback((change: (value: EventSceneSettings) => EventSceneSettings, selection?: Selection, record = true) => {
    const grouped = !!gesture.current
    setState((state) => {
      if (!state.value) return state
      const value = change(state.value)
      if (JSON.stringify(value) === JSON.stringify(state.value)) return state
      return { ...state, ...selection, value, past: grouped || !record ? state.past : [...state.past.slice(-39), snapshot(state)], future: record ? [] : state.future }
    })
  }, [])
  const begin = () => {
    gesture.current = snapshot(state)
  }
  const end = () => {
    const previous = gesture.current
    gesture.current = null
    if (previous) setState(state => JSON.stringify(previous.value) === JSON.stringify(state.value) ? state : { ...state, past: [...state.past.slice(-39), previous], future: [] })
  }
  const undo = () => setState(state => !state.past.length || !state.value ? state : { ...state, ...state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [snapshot(state), ...state.future] })
  const redo = () => setState(state => !state.future.length || !state.value ? state : { ...state, ...state.future[0], past: [...state.past, snapshot(state)], future: state.future.slice(1) })
  const select = (event: SceneEvent, templateId: string) => setState(state => ({ ...state, event, templateId }))
  return { settings: state.value, event: state.event, templateId: state.templateId, select, edit, load, reset, begin, end, undo, redo, canUndo: !!state.past.length, canRedo: !!state.future.length }
}
