import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultLocalTtsConfig, type LocalTtsConfig, type LocalTtsSnapshot, type LocalTtsState } from '../../shared/localTts.js'
import { readTtsStatus, synthesizeGreeting, TtsConnectionError } from './TtsClient.js'

export class TtsSettingsError extends Error {
  constructor (message: string, readonly status = 422) { super(message) }
}

const timings = { waitingMs: 1500, timeoutMs: 600000, startupMs: 120000, retryMs: 500 }
export async function validateTtsInstallation (directory: string) {
  if (!path.isAbsolute(directory) || [...directory].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new TtsSettingsError('Indique una ruta absoluta de la instalación en el servidor.')
  try {
    const resolved = await fs.realpath(directory)
    if (Buffer.byteLength(path.join(resolved, '.tmp', 'model.sock')) > 103) throw new TtsSettingsError('La ruta es demasiado larga para el socket local. Use una ubicación más corta.')
    for (const name of ['model.sh', 'resident.py', 'speak.py']) {
      const file = path.join(resolved, name)
      if (!(await fs.stat(file)).isFile()) throw new Error('Not a file')
      await fs.access(file, constants.R_OK)
    }
    await fs.access(path.join(resolved, '.venv', 'bin', 'python'), constants.X_OK)
    return resolved
  } catch (error) {
    if (error instanceof TtsSettingsError) throw error
    throw new TtsSettingsError('No se encontró una instalación accesible de Chatterbox con model.sh, resident.py, speak.py y .venv/bin/python. Revise la ruta y los permisos.')
  }
}

/** One resident connection operation at a time, including synthesis and recovery. */
export default class LocalTts {
  private config: LocalTtsConfig
  private active: LocalTtsConfig
  private state: LocalTtsState
  private message = ''
  private pid: number | null = null
  private checkedAt: number | null = null
  private operation: Promise<void> | null = null
  private controller?: AbortController
  private owned?: ChildProcess
  private closed = false
  private startRequested = false
  private speechInFlight = false

  constructor (stored: unknown, private persist: (config: LocalTtsConfig) => void, private timing = timings, private generationTimeoutMs = 120000) {
    const value = stored as Partial<LocalTtsConfig> | undefined
    this.config = typeof value?.installationPath === 'string' && typeof value.autoStart === 'boolean' && Number.isSafeInteger(value.revision) && value.revision! >= 0
      ? { installationPath: value.installationPath, autoStart: value.autoStart, revision: value.revision! }
      : { ...defaultLocalTtsConfig }
    this.active = this.config
    this.state = this.config.installationPath ? 'unchecked' : 'unconfigured'
  }

  snapshot (): LocalTtsSnapshot {
    return { config: { ...this.config }, activePath: this.active.installationPath, pending: this.active.revision !== this.config.revision,
      state: this.state, message: this.message, pid: this.pid, managed: !!this.owned, checkedAt: this.checkedAt }
  }

  initialize () { if (this.config.autoStart) this.check(true) }

  async configure (input: unknown) {
    if (this.closed) throw new TtsSettingsError('El servidor se está cerrando.', 503)
    const value = input as Partial<LocalTtsConfig> | null
    if (!value || typeof value.installationPath !== 'string' || typeof value.autoStart !== 'boolean' || !Number.isSafeInteger(value.revision)) throw new TtsSettingsError('Revise la ruta y la configuración de inicio.')
    const directory = value.installationPath.trim()
    if (!directory && value.autoStart) throw new TtsSettingsError('Indique la instalación antes de activar el inicio automático.')
    const installationPath = directory ? await validateTtsInstallation(directory) : ''
    if (this.closed) throw new TtsSettingsError('El servidor se está cerrando.', 503)
    if (value.revision !== this.config.revision) throw new TtsSettingsError('La configuración cambió en otra sesión. Recargue los ajustes antes de guardar.', 409)
    const next = { installationPath, autoStart: value.autoStart, revision: this.config.revision + 1 }
    this.persist(next)
    this.config = next
    if (next.installationPath === this.active.installationPath && !this.speechInFlight) this.active = next
    // Inspect the old worker before switching; a timed-out socket is not proof of idleness.
    this.check(next.autoStart && next.installationPath === this.active.installationPath)
    return this.snapshot()
  }

  check (start = false) {
    if (this.closed) return
    this.startRequested ||= start
    if (this.operation) return
    this.controller = new AbortController()
    this.operation = this.inspect(this.controller.signal).catch((error) => {
      if (this.closed) return
      this.startRequested = false
      this.state = error instanceof TtsConnectionError && error.code === 'MISSING' ? 'unavailable' : 'error'
      this.message = error instanceof TtsConnectionError || error instanceof TtsSettingsError ? error.message : 'No se pudo iniciar Chatterbox. Revise la instalación y vuelva a comprobarla.'
      this.pid = null
    }).finally(() => {
      this.operation = null
      // A configuration save can arrive after inspect returns but before this
      // promise settles. Drain that change without retrying an uncertain worker.
      const pending = this.active.revision !== this.config.revision
      if (!this.closed && (this.startRequested || (pending && ['ready', 'unavailable', 'unconfigured'].includes(this.state)))) this.check()
    })
  }

  private async probe (signal: AbortSignal, timeoutMs = this.timing.timeoutMs) {
    return readTtsStatus(this.active.installationPath, { ...this.timing, timeoutMs, signal, onWaiting: () => {
      this.state = 'busy'
      this.message = 'El modelo puede estar procesando una solicitud. Se espera su respuesta sin detener la música.'
    } })
  }

  canGenerate (revision: number) {
    return !this.closed && !this.operation && this.state === 'ready' && this.config.revision === revision && this.active.revision === revision
  }

  generate (text: string, output: string, reference: string, revision: number): Promise<void> {
    if (!this.canGenerate(revision)) return Promise.reject(new TtsConnectionError('El modelo todavía no está disponible para este saludo.', 'NOT_READY'))
    this.controller = new AbortController()
    this.speechInFlight = true
    this.state = 'generating'
    this.message = 'Preparando un saludo mientras su pedido espera. La música continúa.'
    const installationPath = this.active.installationPath
    const signal = this.controller.signal
    const result = Promise.resolve().then(() => synthesizeGreeting(installationPath, text, output, reference, {
      ...this.timing, timeoutMs: this.generationTimeoutMs, signal, onWaiting: () => {},
    })).then(() => {
      if (!this.closed) {
        this.state = 'ready'
        this.message = 'La generación terminó. El audio se está validando.'
      }
      return undefined
    }).catch((error: TtsConnectionError) => {
      if (!this.closed) {
        this.state = error.uncertain ? 'recovering' : error.code === 'REJECTED' ? 'ready' : 'unavailable'
        this.message = error.uncertain ? 'Esperando que termine la solicitud anterior antes de generar otro saludo.' : error.message
      }
      throw error
    })
    this.operation = result.then(() => undefined, () => undefined).finally(() => {
      this.speechInFlight = false
      this.operation = null
      if (!this.closed && this.state === 'ready' && (this.active.revision !== this.config.revision || this.startRequested)) this.check()
    })
    return result
  }

  /** Fence the original installation after a lost reply or a server restart. */
  settleGeneration (installationPath: string): Promise<boolean> {
    if (this.closed || this.operation) return Promise.resolve(false)
    this.controller = new AbortController()
    this.speechInFlight = true
    this.state = 'recovering'
    this.message = 'Comprobando que la generación anterior terminó antes de continuar.'
    const result = readTtsStatus(installationPath, { ...this.timing, signal: this.controller.signal, onWaiting: () => {} })
      .then(() => true).catch((error: TtsConnectionError) => error.code === 'MISSING')
    this.operation = result.then((settled) => {
      if (this.closed) return undefined
      this.state = settled ? 'unchecked' : 'error'
      this.message = settled ? 'La solicitud anterior terminó.' : 'El modelo anterior no confirmó su estado. Los saludos continúan en pantalla.'
      return undefined
    }).finally(() => {
      this.speechInFlight = false
      this.operation = null
      if (!this.closed && this.state === 'unchecked') this.check(this.config.autoStart)
    })
    return result
  }

  private async inspect (signal: AbortSignal) {
    while (!this.closed) {
      let missing = !this.active.installationPath
      if (!missing) {
        this.state = 'checking'
        this.message = 'Comprobando el proceso residente de Chatterbox.'
        try {
          this.pid = await this.probe(signal)
          this.checkedAt = Date.now()
          this.state = 'ready'
          this.message = 'Chatterbox responde y tiene el modelo cargado.'
        } catch (error) {
          if (!(error instanceof TtsConnectionError) || error.code !== 'MISSING') throw error
          missing = true
          this.pid = null
        }
      }
      if (signal.aborted) return
      if (this.active.revision !== this.config.revision) {
        if (this.active.installationPath !== this.config.installationPath) await this.releaseOwned()
        if (signal.aborted) return
        this.active = this.config
        this.pid = null
        this.checkedAt = null
        this.startRequested = this.active.autoStart
        continue
      }
      if (!this.active.installationPath) {
        this.state = 'unconfigured'
        this.message = 'Guarde la ruta de Chatterbox para comprobar la conexión.'
      } else if (missing && this.startRequested) {
        this.startRequested = false
        await this.launch(signal)
        // Configuration may have changed during model loading.
        if (this.active.revision !== this.config.revision) continue
      } else if (missing) {
        this.state = 'unavailable'
        this.message = 'El modelo no está disponible. Pulse Iniciar modelo para cargarlo.'
      }
      this.startRequested = false
      return
    }
  }

  private async launch (signal: AbortSignal) {
    await validateTtsInstallation(this.active.installationPath)
    if (signal.aborted) return
    this.state = 'starting'
    this.message = 'Cargando el modelo en memoria. Puede continuar usando el karaoke.'
    if (!this.owned) {
      // _serve uses the same resident lock as `model.sh start`, but keeps this exact
      // child owned by the server. Never signal a PID supplied by an external socket.
      const child = spawn('/bin/bash', [path.join(this.active.installationPath, 'model.sh'), '_serve'], { cwd: this.active.installationPath, stdio: 'ignore' })
      this.owned = child
      child.on('error', () => {}) // Startup failure is reported by the bounded readiness check.
      child.once('close', () => {
        if (this.owned !== child) return
        this.owned = undefined
        if (!this.closed && this.pid === child.pid) {
          this.pid = null
          this.state = 'unavailable'
          this.message = 'El proceso de voz se detuvo. Puede volver a iniciarlo.'
        }
      })
    }
    const child = this.owned
    const deadline = Date.now() + this.timing.startupMs
    while (!signal.aborted && Date.now() < deadline) {
      try {
        this.pid = await this.probe(signal, Math.min(this.timing.timeoutMs, Math.max(1, deadline - Date.now())))
        this.checkedAt = Date.now()
        this.state = 'ready'
        this.message = 'Chatterbox responde y tiene el modelo cargado.'
        return
      } catch (error) {
        if (!(error instanceof TtsConnectionError) || error.code !== 'MISSING') throw error
        if (child.exitCode !== null && child.exitCode !== 0) throw new Error('Worker exited')
        await delay(this.timing.retryMs, undefined, { signal })
      }
    }
    throw new TtsConnectionError('El modelo todavía no confirmó el arranque. Revise la instalación o vuelva a comprobar su estado.', 'TIMEOUT')
  }

  private async releaseOwned () {
    const child = this.owned
    if (!child) return
    this.owned = undefined
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => child.kill('SIGKILL'), 1500)
      const deadline = setTimeout(() => {
        clearTimeout(force)
        reject(new Error('Worker did not stop'))
      }, 3000)
      child.once('close', () => {
        clearTimeout(force)
        clearTimeout(deadline)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  async close () {
    this.closed = true
    this.controller?.abort()
    await this.operation
    await this.releaseOwned()
  }
}
