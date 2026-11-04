import { expect, it } from 'vitest'
import type { TransitionVideo, TransitionVideoOverview } from '../../../shared/transitionVideo.js'
import { initialVideoSettings, transitionVideoReducer as reduce } from './transitionVideoState.js'

const video = (id: string, state: TransitionVideo['state'] = 'ready'): TransitionVideo => ({
  id, roomId: 1, requestId: id, title: id, state, reason: state === 'failed' ? 'Archivo inválido' : null,
  durationMs: 1000, width: 1280, height: 720, frameRate: 30, size: 1024, checksum: id,
  videoUrl: `api/videos/${id}`, posterUrl: `api/posters/${id}`, createdAt: 1, updatedAt: 1,
})
const overview = (revision = 0): TransitionVideoOverview => ({
  settings: { videoId: 'saved', dimOpacity: 0.55, revision }, selected: video('saved'), candidate: video('new', 'preparing'),
  capability: { available: true, busy: true, reason: null },
})
const loaded = () => reduce(initialVideoSettings, { type: 'receive', overview: overview() })

it('updates preparation without moving the slider or discarding the pending selection', () => {
  let state = loaded()
  state = reduce(state, { type: 'opacity', value: 0.78 })
  state = reduce(state, { type: 'select', resource: video('new', 'preparing') })
  state = reduce(state, { type: 'receive', overview: { ...overview(), candidate: video('new') } })
  expect(state.draft).toEqual({ videoId: 'new', dimOpacity: 0.78, revision: 0 })
  expect(state.resource?.state).toBe('ready')
})

it('keeps an explicitly cleared selection through polling and reconnection', () => {
  let state = reduce(loaded(), { type: 'select', resource: null })
  state = reduce(state, { type: 'connection', message: 'Disconnected' })
  state = reduce(state, { type: 'receive', overview: overview() })
  expect(state.draft?.videoId).toBeNull()
  expect(state.resource).toBeNull()
  expect(state.connectionError).toBe('')
})

it('requires an explicit reload on a remote revision change and keeps local edits until then', () => {
  let state = reduce(loaded(), { type: 'opacity', value: 0.7 })
  const remote = { ...overview(1), settings: { videoId: 'saved', dimOpacity: 0.3, revision: 1 } }
  state = reduce(state, { type: 'receive', overview: remote })
  expect(state.conflict).toBe(true)
  expect(state.draft?.dimOpacity).toBe(0.7)
  state = reduce(state, { type: 'receive', overview: remote, reset: true })
  expect(state.conflict).toBe(false)
  expect(state.draft).toEqual(remote.settings)
})

it('does not apply a late GET after a confirmed save', () => {
  let state = loaded()
  state = reduce(state, { type: 'saveStart', settings: state.draft! })
  state = reduce(state, { type: 'saveResult', overview: overview(1) })
  state = reduce(state, { type: 'receive', overview: overview(0) })
  expect(state.draft?.revision).toBe(1)
  expect(state.overview?.settings.revision).toBe(1)
  expect(state.notice).toBe('Fondo guardado.')
})

it('reconciles a committed save after its response was lost without issuing another mutation', () => {
  let state = reduce(loaded(), { type: 'opacity', value: 0.84 })
  const submitted = state.draft!
  state = reduce(state, { type: 'saveStart', settings: submitted })
  state = reduce(state, { type: 'saveUncertain', message: 'Unconfirmed' })
  state = reduce(state, { type: 'receive', overview: overview() })
  expect(state.pendingSave).toEqual(submitted)
  const committed = { ...overview(1), settings: { ...submitted, revision: 1 } }
  state = reduce(state, { type: 'receive', overview: committed })
  expect(state.pendingSave).toBeNull()
  expect(state.error).toBe('')
  expect(state.draft).toEqual(committed.settings)
  expect(state.notice).toBe('Fondo guardado.')
})

it('does not report an uncertain save as successful when another operator saved different settings', () => {
  let state = reduce(loaded(), { type: 'opacity', value: 0.84 })
  state = reduce(state, { type: 'saveStart', settings: state.draft! })
  state = reduce(state, { type: 'saveUncertain', message: 'Unconfirmed' })
  state = reduce(state, { type: 'receive', overview: overview(1) })
  expect(state.conflict).toBe(true)
  expect(state.pendingSave).toBeNull()
  expect(state.draft?.dimOpacity).toBe(0.84)
  expect(state.notice).not.toBe('Fondo guardado.')
})

it('keeps controls saving while a poll observes the write before the response', () => {
  let state = loaded()
  state = reduce(state, { type: 'saveStart', settings: state.draft! })
  state = reduce(state, { type: 'receive', overview: overview(1) })
  expect(state.operation).toBe('saving')
  expect(state.pendingSave).not.toBeNull()
  state = reduce(state, { type: 'saveResult', overview: overview(1) })
  expect(state.operation).toBe('idle')
  expect(state.conflict).toBe(false)
})

it('accepts an uploaded candidate without losing darkness edits or modifying the saved settings', () => {
  let state = reduce(loaded(), { type: 'opacity', value: 0.75 })
  state = reduce(state, { type: 'uploadDone', resource: video('upload', 'preparing') })
  expect(state.draft).toEqual({ videoId: 'upload', dimOpacity: 0.75, revision: 0 })
  expect(state.overview?.settings.videoId).toBe('saved')
  state = reduce(state, { type: 'receive', overview: { ...overview(), candidate: video('upload', 'failed') } })
  expect(state.resource?.reason).toBe('Archivo inválido')
  expect(state.notice).toBe('')
})

it('preserves a disappeared draft resource instead of silently choosing a replacement', () => {
  let state = reduce(loaded(), { type: 'select', resource: video('new') })
  state = reduce(state, { type: 'receive', overview: { ...overview(), candidate: video('other') } })
  expect(state.draft?.videoId).toBe('new')
  expect(state.resource?.id).toBe('new')
})

it('marks a confirmed retirement unavailable without discarding selection or darkness', () => {
  let state = reduce(loaded(), { type: 'select', resource: video('new') })
  state = reduce(state, { type: 'opacity', value: 0.7 })
  state = reduce(state, { type: 'unavailable', id: 'new' })
  expect(state.draft).toEqual({ videoId: 'new', dimOpacity: 0.7, revision: 0 })
  expect(state.resource).toMatchObject({ state: 'failed', videoUrl: null, posterUrl: null })
})

it('ignores late resource lookups for a selection the operator already changed', () => {
  const state = reduce(loaded(), { type: 'select', resource: video('new') })
  expect(reduce(state, { type: 'resource', resource: video('saved') })).toEqual(state)
  expect(reduce(state, { type: 'unavailable', id: 'saved' })).toEqual(state)
})

it('preserves the draft after a rejected save', () => {
  let state = reduce(loaded(), { type: 'opacity', value: 0.85 })
  state = reduce(state, { type: 'saveStart', settings: state.draft! })
  state = reduce(state, { type: 'saveRejected', message: 'No disponible' })
  expect(state.pendingSave).toBeNull()
  expect(state.draft?.dimOpacity).toBe(0.85)
  expect(state.error).toBe('No disponible')
})
