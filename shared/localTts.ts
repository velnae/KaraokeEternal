export interface LocalTtsConfig {
  installationPath: string
  autoStart: boolean
  revision: number
}

export const defaultLocalTtsConfig: LocalTtsConfig = { installationPath: '', autoStart: false, revision: 0 }
export type LocalTtsState = 'unconfigured' | 'unchecked' | 'checking' | 'starting' | 'ready' | 'busy' | 'unavailable' | 'error'
export interface LocalTtsSnapshot {
  config: LocalTtsConfig
  activePath: string
  pending: boolean
  state: LocalTtsState
  message: string
  pid: number | null
  managed: boolean
  checkedAt: number | null
}

export const localTtsLabels: Record<LocalTtsState, string> = {
  unconfigured: 'Sin configurar', unchecked: 'Pendiente de comprobar', checking: 'Comprobando conexión',
  starting: 'Cargando modelo', ready: 'Modelo listo', busy: 'Ocupado o sin respuesta',
  unavailable: 'Sin conexión', error: 'Requiere atención',
}
