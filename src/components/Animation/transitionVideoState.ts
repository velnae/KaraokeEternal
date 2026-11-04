import type { TransitionVideo, TransitionVideoOverview, TransitionVideoPrefs } from 'shared/transitionVideo'

export type VideoSettingsOperation = 'idle' | 'uploading' | 'recovering' | 'saving' | 'reloading'
export interface VideoSettingsState {
  overview: TransitionVideoOverview | null
  draft: TransitionVideoPrefs | null
  resource: TransitionVideo | null
  operation: VideoSettingsOperation
  progress: number | null
  error: string
  connectionError: string
  notice: string
  conflict: boolean
  pendingSave: TransitionVideoPrefs | null
  retryUpload: boolean
}
export const initialVideoSettings: VideoSettingsState = {
  overview: null, draft: null, resource: null, operation: 'idle', progress: null,
  error: '', connectionError: '', notice: '', conflict: false, pendingSave: null, retryUpload: false,
}

type Action = { type: 'receive', overview: TransitionVideoOverview, reset?: boolean }
  | { type: 'connection', message: string }
  | { type: 'resource', resource: TransitionVideo }
  | { type: 'unavailable', id: string }
  | { type: 'operation', operation: VideoSettingsOperation }
  | { type: 'progress', value: number | null }
  | { type: 'select', resource: TransitionVideo | null }
  | { type: 'opacity', value: number }
  | { type: 'uploadDone', resource: TransitionVideo }
  | { type: 'uploadFailed', message: string, retry: boolean }
  | { type: 'saveStart', settings: TransitionVideoPrefs }
  | { type: 'saveResult', overview: TransitionVideoOverview }
  | { type: 'saveUncertain', message: string }
  | { type: 'saveRejected', message: string }
  | { type: 'error', message: string }

const resourceFor = (overview: TransitionVideoOverview, id: string | null) => [overview.selected, overview.candidate].find(video => video && video.id === id) ?? null
export const sameVideoAppearance = (a: TransitionVideoPrefs, b: TransitionVideoPrefs) => a.videoId === b.videoId && a.dimOpacity === b.dimOpacity
export const confirmsVideoSave = (current: TransitionVideoPrefs, submitted: TransitionVideoPrefs) => current.revision > submitted.revision && sameVideoAppearance(current, submitted)

function savedResult (state: VideoSettingsState, overview: TransitionVideoOverview): VideoSettingsState {
  if (!state.pendingSave || !confirmsVideoSave(overview.settings, state.pendingSave)) {
    return { ...state, overview, operation: 'idle', pendingSave: null, conflict: true,
      error: 'La configuración cambió. Recargue el fondo antes de guardar.', notice: '' }
  }
  return { ...state, overview, draft: overview.settings, resource: resourceFor(overview, overview.settings.videoId),
    operation: 'idle', pendingSave: null, conflict: false, error: '', connectionError: '', notice: 'Fondo guardado.' }
}

export function transitionVideoReducer (state: VideoSettingsState, action: Action): VideoSettingsState {
  switch (action.type) {
    case 'receive': {
      // An old GET must never undo a newer save or a conflict already observed.
      if (state.overview && action.overview.settings.revision < state.overview.settings.revision) return state
      const overview = action.overview
      if (!state.draft || action.reset) return { ...initialVideoSettings, overview, draft: overview.settings,
        resource: resourceFor(overview, overview.settings.videoId), notice: action.reset ? 'Configuración recargada.' : '' }
      if (state.pendingSave && state.operation !== 'saving' && overview.settings.revision > state.pendingSave.revision) return savedResult(state, overview)
      const resource = resourceFor(overview, state.draft.videoId) ?? state.resource
      return { ...state, overview, connectionError: '',
        resource, notice: state.resource?.state === 'preparing' && resource?.state !== 'preparing'
          ? resource?.state === 'ready' ? 'Video listo. Revise la vista previa y guarde el fondo.' : ''
          : state.notice,
        conflict: state.conflict || (!state.pendingSave && overview.settings.revision !== state.draft.revision) }
    }
    case 'connection': return { ...state, connectionError: action.message }
    case 'resource': return state.draft?.videoId === action.resource.id ? { ...state, resource: action.resource } : state
    case 'unavailable': return state.draft?.videoId === action.id && state.resource
      ? { ...state, resource: { ...state.resource, state: 'failed', reason: 'Este video ya no está disponible. Seleccione otro video o quite la selección.', videoUrl: null, posterUrl: null } }
      : state
    case 'operation': return { ...state, operation: action.operation, error: '', notice: '', progress: action.operation === 'uploading' ? 0 : state.progress }
    case 'progress': return { ...state, progress: action.value }
    case 'select': return state.draft ? { ...state, draft: { ...state.draft, videoId: action.resource?.id ?? null }, resource: action.resource, notice: '', error: '' } : state
    case 'opacity': return state.draft ? { ...state, draft: { ...state.draft, dimOpacity: action.value }, notice: '', error: '' } : state
    case 'uploadDone': return { ...state, operation: 'idle', retryUpload: false, error: '', connectionError: '',
      draft: state.draft ? { ...state.draft, videoId: action.resource.id } : null, resource: action.resource,
      overview: state.overview ? { ...state.overview, candidate: action.resource } : null,
      notice: action.resource.state === 'preparing' ? 'Video recibido. Preparando la vista previa…' : 'Carga recuperada. Revise el video antes de guardar.' }
    case 'uploadFailed': return { ...state, operation: 'idle', retryUpload: action.retry, error: action.message, notice: '' }
    case 'saveStart': return { ...state, operation: 'saving', pendingSave: action.settings, error: '', notice: '' }
    case 'saveResult': {
      const overview = state.overview && state.overview.settings.revision > action.overview.settings.revision ? state.overview : action.overview
      return savedResult(state, overview)
    }
    case 'saveUncertain': return { ...state, operation: 'idle', error: action.message, notice: '' }
    case 'saveRejected': return { ...state, operation: 'idle', pendingSave: null, error: action.message, notice: '' }
    case 'error': return { ...state, operation: 'idle', error: action.message, notice: '' }
  }
}
