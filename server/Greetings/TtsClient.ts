import { createConnection } from 'node:net'
import path from 'node:path'

export class TtsConnectionError extends Error {
  constructor (message: string, readonly code: string, readonly uncertain = false) { super(message) }
}

export interface TtsProbeOptions {
  signal: AbortSignal
  onWaiting: () => void
  waitingMs: number
  timeoutMs: number
}

function requestTts<T> (installationPath: string, payload: object, options: TtsProbeOptions, validate: (result: unknown) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new TtsConnectionError('Comprobación cancelada.', 'ABORTED'))
    const socket = createConnection({ path: path.join(installationPath, '.tmp', 'model.sock') })
    let bytes = Buffer.alloc(0)
    let settled = false
    let sent = false
    let waiting: ReturnType<typeof setTimeout> | undefined
    const deadline = setTimeout(() => finish(new TtsConnectionError('El modelo no confirmó su disponibilidad. Compruebe la instalación antes de reintentar.', 'TIMEOUT')), options.timeoutMs)
    const abort = () => finish(new TtsConnectionError('Comprobación cancelada.', 'ABORTED'))
    function finish (error?: TtsConnectionError, result?: T) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(waiting)
      options.signal.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(new TtsConnectionError(error.message, error.code, sent && error.code !== 'REJECTED'))
      else resolve(result!)
    }
    options.signal.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => {
      if (settled) return
      waiting = setTimeout(options.onWaiting, options.waitingMs)
      sent = true
      socket.write(JSON.stringify(payload) + '\n')
    })
    socket.on('data', (chunk: Buffer) => {
      if (bytes.length + chunk.length > 4096) return finish(new TtsConnectionError('La respuesta no corresponde al servicio Chatterbox esperado.', 'PROTOCOL'))
      bytes = Buffer.concat([bytes, chunk])
      const end = bytes.indexOf(10)
      if (end < 0) return
      try {
        const response = JSON.parse(bytes.subarray(0, end).toString('utf8'))
        if (response?.ok === false) return finish(new TtsConnectionError('El modelo no pudo completar la solicitud. El saludo se mostrará en pantalla.', 'REJECTED'))
        if (response?.ok !== true) throw new Error('Invalid response')
        finish(undefined, validate(response.result))
      } catch { finish(new TtsConnectionError('La respuesta no corresponde al servicio Chatterbox esperado.', 'PROTOCOL')) }
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      const missing = ['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '')
      finish(new TtsConnectionError(missing ? 'El modelo no está disponible. Puede iniciarlo desde aquí.' : 'No se pudo acceder al modelo. Revise los permisos de la instalación y del socket.', missing ? 'MISSING' : 'ACCESS'))
    })
    socket.once('close', () => finish(new TtsConnectionError('El modelo cerró la conexión sin confirmar su estado. Vuelva a comprobarlo.', 'CLOSED')))
  })
}

/** The resident worker serializes status behind inference. Keep one bounded probe open. */
export function readTtsStatus (installationPath: string, options: TtsProbeOptions): Promise<number> {
  return requestTts(installationPath, { action: 'status' }, options, (value) => {
    const result = value as { status?: string, pid?: number } | null
    if (result?.status !== 'ready' || !Number.isSafeInteger(result.pid) || result.pid! <= 0) throw new Error('Invalid status')
    return result.pid!
  })
}

export function synthesizeGreeting (installationPath: string, text: string, output: string, reference: string, options: TtsProbeOptions) {
  if (!text.trim() || [...text].length > 300 || !path.isAbsolute(output) || !path.isAbsolute(reference)) throw new TtsConnectionError('El saludo o sus archivos no son válidos para la generación.', 'INPUT')
  // The separator keeps client text from becoming argparse options. File paths and
  // flags are supplied exclusively by the server, never by a participant.
  return requestTts(installationPath, { action: 'say', args: ['--output', output, '--reference', reference, '--seed', '42', '--', text] }, options, (value) => {
    const result = value as { output?: string, audio_seconds?: number, sample_rate?: number } | null
    if (result?.output !== output || !Number.isFinite(result.audio_seconds) || result.audio_seconds! <= 0 || !Number.isFinite(result.sample_rate) || result.sample_rate! <= 0) throw new Error('Invalid audio response')
  })
}
