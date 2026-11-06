import HttpApi from './HttpApi'
import type { TransitionVideo, TransitionVideoOverview, TransitionVideoPrefs } from 'shared/transitionVideo'

const api = new HttpApi('animation/background/')
export const transitionVideoUrl = (relative: string) => new URL(relative, document.baseURI).href

async function boundedRequest<T> (request: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 15_000)
  try {
    return await request(controller.signal)
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

export const getTransitionVideoOverview = (signal: AbortSignal) => boundedRequest(
  signal => api.get<TransitionVideoOverview>('', { signal }), signal)
export const getTransitionVideoResource = (id: string, signal: AbortSignal) => boundedRequest(
  signal => api.get<TransitionVideo>(`videos/${encodeURIComponent(id)}`, { signal }), signal)
export const saveTransitionVideo = (settings: TransitionVideoPrefs, signal: AbortSignal) => boundedRequest(
  signal => api.put<TransitionVideoOverview>('', { body: settings, signal }), signal)
export const changeTransitionVideo = (id: string, active: boolean | 'delete', signal: AbortSignal) => boundedRequest(
  signal => active === 'delete'
    ? api.delete<TransitionVideoOverview>(`videos/${encodeURIComponent(id)}`, { signal })
    : api.request<TransitionVideoOverview>('PATCH', `videos/${encodeURIComponent(id)}`, { body: { active }, signal }), signal)
export const recoverTransitionVideoUpload = (requestId: string, signal: AbortSignal) => boundedRequest(
  signal => api.post<TransitionVideo>('upload', { headers: { 'X-Upload-Request-Id': requestId }, signal }), signal)

export function transitionVideoError (error: unknown) {
  const status = (error as { status?: number })?.status
  if (status === 401 || status === 403) return 'Ingrese nuevamente como administrador de esta sala para continuar.'
  if (status) return (error as Error).message
  return 'No se pudo confirmar la respuesta del servidor. Compruebe la conexión y vuelva a intentar.'
}

export function uploadTransitionVideo (file: File, requestId: string, signal: AbortSignal, onProgress: (percent: number | null) => void): Promise<TransitionVideo> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Carga cancelada', 'AbortError'))
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      xhr.upload.onprogress = null
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null
    }
    const fail = (error: Error) => {
      cleanup()
      reject(error)
    }
    xhr.upload.onprogress = event => onProgress(event.lengthComputable ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null)
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return fail(Object.assign(new Error(xhr.responseText || 'No se pudo subir el video.'), { status: xhr.status }))
      try {
        const video: TransitionVideo = JSON.parse(xhr.responseText)
        cleanup()
        resolve(video)
      } catch { fail(new Error('La respuesta del servidor no es válida.')) }
    }
    xhr.onerror = xhr.ontimeout = () => fail(new Error('No se pudo confirmar la carga.'))
    xhr.onabort = () => fail(new DOMException('Carga cancelada', 'AbortError'))
    xhr.open('POST', transitionVideoUrl('api/animation/background/upload'))
    xhr.withCredentials = true
    xhr.timeout = 130_000
    xhr.setRequestHeader('X-Upload-Request-Id', requestId)
    signal.addEventListener('abort', abort, { once: true })
    const body = new FormData()
    body.append('requestId', requestId)
    body.append('file', file)
    xhr.send(body)
  })
}
