import { describe, expect, it, vi } from 'vitest'
import reducer from './playerVisualizer'
import { PLAYER_CMD_OPTIONS } from '../../../../shared/actionTypes.js'

const loadDefinitions = vi.hoisted(() => vi.fn())
vi.mock('butterchurn-presets/all', () => {
  loadDefinitions()
  return { default: {} }
})

describe('visualizer preset index', () => {
  it('initializes player settings without loading the preset definitions', () => {
    const state = reducer(undefined, { type: 'initialize' })
    expect(state.presetKey).toBeTruthy()
    expect(state.presetName).toContain(state.presetKey)
    expect(loadDefinitions).not.toHaveBeenCalled()
  })

  it('preserves the full preset catalog and Next/Previous order', async () => {
    const { default: presets } = await vi.importActual<typeof import('butterchurn-presets/all')>('butterchurn-presets/all')
    const keys = Object.keys(presets).filter(key => !['Flexi + Martin - astral projection', 'Rovastar & Loadus + Zylot - FractalDrop (Spark Machine v2.0)'].includes(key))
    let state = { ...reducer(undefined, { type: 'initialize' }), presetKey: keys[0] }
    const order = [state.presetKey]
    for (let i = 1; i < keys.length; i++) {
      state = reducer(state, { type: PLAYER_CMD_OPTIONS, payload: { visualizer: { nextPreset: true } } })
      order.push(state.presetKey)
    }
    expect(order).toEqual(keys)
    state = reducer(state, { type: PLAYER_CMD_OPTIONS, payload: { visualizer: { nextPreset: true } } })
    expect(state.presetKey).toBe(keys[0])
    state = reducer(state, { type: PLAYER_CMD_OPTIONS, payload: { visualizer: { prevPreset: true } } })
    expect(state.presetKey).toBe(keys[keys.length - 1])
  })
})
