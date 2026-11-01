import { createConnection } from 'node:net'
import path from 'node:path'

export class TtsConnectionError extends Error {
  constructor (message: string, readonly code: string) { super(message) }
}

export interface TtsProbeOptions {
  signal: AbortSignal
  onWaiting: () => void
  waitingMs: number
  timeoutMs: number
}

/** The resident worker serializes status behind inference. Keep one bounded probe open. */
export function readTtsStatus (installationPath: string, options: TtsProbeOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new TtsConnectionError('Comprobación cancelada.', 'ABORTED'))
    const socket = createConnection({ path: path.join(installationPath, '.tmp', 'model.sock') })
    let bytes = Buffer.alloc(0)
    let settled = false
    let waiting: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(() => finish(new TtsConnectionError('El modelo no confirmó su disponibilidad. Compruebe la instalación antes de reintentar.', 'TIMEOUT')), options.timeoutMs)
    const abort = () => finish(new TtsConnectionError('Comprobación cancelada.', 'ABORTED'))
    function finish (error?: Error, pid?: number) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(waiting)
      options.signal.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(pid!)
    }
    options.signal.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => {
      if (settled) return
      waiting = setTimeout(options.onWaiting, options.waitingMs)
      socket.write('{"action":"status"}\n')
    })
    socket.on('data', (chunk: Buffer) => {
      if (bytes.length + chunk.length > 4096) return finish(new TtsConnectionError('La respuesta no corresponde al servicio Chatterbox esperado.', 'PROTOCOL'))
      bytes = Buffer.concat([bytes, chunk])
      const end = bytes.indexOf(10)
      if (end < 0) return
      try {
        const response = JSON.parse(bytes.subarray(0, end).toString('utf8'))
        if (response?.ok !== true || response.result?.status !== 'ready' || !Number.isSafeInteger(response.result.pid) || response.result.pid <= 0) throw new Error('Invalid status')
        finish(undefined, response.result.pid)
      } catch { finish(new TtsConnectionError('La respuesta no corresponde al servicio Chatterbox esperado.', 'PROTOCOL')) }
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      const missing = ['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')
      finish(new TtsConnectionError(missing ? 'El modelo no está disponible. Puede iniciarlo desde aquí.' : 'No se pudo acceder al modelo. Revise los permisos de la instalación y del socket.', missing ? 'MISSING' : 'ACCESS'))
    })
    socket.once('close', () => finish(new TtsConnectionError('El modelo cerró la conexión sin confirmar su estado. Vuelva a comprobarlo.', 'CLOSED')))
  })
}
