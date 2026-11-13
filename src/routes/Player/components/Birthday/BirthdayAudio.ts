import { birthdayLimits, type BirthdayAsset } from '../../../../../shared/birthdays.js'

export class BirthdayAudio {
  private buffers = new Map<string, AudioBuffer>()
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private multiplier = 1
  private bedSource: AudioBufferSourceNode | null = null
  private bedGain: GainNode | null = null
  private bedMultiplier = 1
  private bedEnd = 0
  private bedStop: (() => void) | null = null
  private permitUntil = 0
  private wallPermitUntil = 0
  constructor (private context: AudioContext) {}

  durationMs (asset: BirthdayAsset) {
    const buffer = this.buffers.get(asset.id)
    if (!buffer) throw new Error('El audio no está preparado.')
    return buffer.duration * 1000
  }

  volume (value: number) {
    this.gain?.gain.setValueAtTime(value * this.multiplier, this.context.currentTime)
    this.bedGain?.gain.setValueAtTime(value * this.bedMultiplier, this.context.currentTime)
  }

  // Schedule on the audio clock: background-tab timers cannot extend authority.
  permitFor (milliseconds: number) {
    if ((this.source || this.bedSource) && (this.context.currentTime >= this.permitUntil || performance.now() >= this.wallPermitUntil)) return
    const duration = Math.max(0, milliseconds) / 1000
    this.permitUntil = this.context.currentTime + duration
    this.wallPermitUntil = performance.now() + Math.max(0, milliseconds)
    this.source?.stop(this.permitUntil)
    this.bedSource?.stop(Math.min(this.permitUntil, this.bedEnd))
  }

  async playBackground (asset: BirthdayAsset, volume: number, signal: AbortSignal, durationMs: number, multiplier = 1, fadeMs = 0) {
    const buffer = this.buffers.get(asset.id)
    if (!buffer || durationMs <= 0) return
    signal.throwIfAborted()
    if (this.context.state !== 'running' || this.permitUntil <= this.context.currentTime || performance.now() >= this.wallPermitUntil) return
    if (Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('La duración del ambiente no coincide con el recurso.')
    this.stopBackground()
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    this.bedMultiplier = multiplier
    this.bedSource = source
    this.bedGain = gain
    this.bedEnd = this.context.currentTime + durationMs / 1000
    source.buffer = buffer
    source.loop = true
    source.connect(gain)
    gain.connect(this.context.destination)
    const level = volume * multiplier
    gain.gain.value = level
    if (fadeMs > 0) {
      const fade = Math.min(fadeMs / 1000, durationMs / 2000)
      gain.gain.setValueAtTime(0, this.context.currentTime)
      gain.gain.linearRampToValueAtTime(level, this.context.currentTime + fade)
      gain.gain.setValueAtTime(level, this.bedEnd - fade)
      gain.gain.linearRampToValueAtTime(0, this.bedEnd)
    }
    const stop = () => this.stopBackground()
    const state = () => {
      if (this.context.state !== 'running') stop()
    }
    signal.addEventListener('abort', stop, { once: true })
    this.context.addEventListener('statechange', state)
    this.bedStop = () => {
      source.onended = null
      source.stop()
      source.disconnect()
      gain.disconnect()
      signal.removeEventListener('abort', stop)
      this.context.removeEventListener('statechange', state)
      this.bedSource = null
      this.bedGain = null
    }
    source.onended = stop
    source.start()
    source.stop(Math.min(this.permitUntil, this.bedEnd))
  }

  stopBackground () {
    const stop = this.bedStop
    this.bedStop = null
    stop?.()
  }

  async prepare (assets: BirthdayAsset[], signal: AbortSignal) {
    for (const asset of assets.filter(item => item.kind !== 'video')) {
      if (this.buffers.has(asset.id)) continue
      if (!asset.url.startsWith('api/birthdays/assets/') && !/^api\/animation\/assets\/[\w-]+$/.test(asset.url)) throw new Error('Recurso de cumpleaños inválido.')
      const response = await fetch(new URL(asset.url, document.baseURI), { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error('No se pudo descargar el audio del cumpleaños.')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('El audio excede el tamaño permitido.')
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      if (hash !== asset.checksum) throw new Error('El audio del cumpleaños cambió. Vuelva a prepararlo.')
      const buffer = await this.context.decodeAudioData(bytes.slice(0))
      signal.throwIfAborted()
      const limit = asset.kind === 'music' ? birthdayLimits.musicMs : birthdayLimits.voiceMs
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration * 1000 > limit + 100 || Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('La duración del audio no coincide con el evento.')
      this.buffers.set(asset.id, buffer)
    }
  }

  async play (asset: BirthdayAsset, volume: number, signal: AbortSignal, onStarted?: (durationMs: number) => void, fadeMs = 0, multiplier = 1) {
    this.multiplier = multiplier
    volume *= multiplier
    signal.throwIfAborted()
    const buffer = this.buffers.get(asset.id)
    if (!buffer) throw new Error('El audio no está preparado.')
    signal.throwIfAborted()
    const limit = asset.kind === 'music' ? birthdayLimits.musicMs : birthdayLimits.voiceMs
    if (buffer.duration * 1000 > limit + 100 || Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('La duración del audio no coincide con el evento.')
    if (this.context.state !== 'running') throw new Error('Active el sonido del reproductor y vuelva a programar el evento.')
    if (this.permitUntil <= this.context.currentTime || this.wallPermitUntil <= performance.now()) throw new Error('El permiso de reproducción venció. Vuelva a programar el cumpleaños.')
    await new Promise<void>((resolve, reject) => {
      const source = this.context.createBufferSource()
      this.source = source
      const gain = this.context.createGain()
      this.gain = gain
      source.buffer = buffer
      gain.gain.value = volume
      if (fadeMs > 0) {
        const fade = Math.min(fadeMs / 1000, buffer.duration / 2)
        gain.gain.setValueAtTime(0, this.context.currentTime)
        gain.gain.linearRampToValueAtTime(volume, this.context.currentTime + fade)
        gain.gain.setValueAtTime(volume, this.context.currentTime + buffer.duration - fade)
        gain.gain.linearRampToValueAtTime(0, this.context.currentTime + buffer.duration)
      }
      source.connect(gain).connect(this.context.destination)
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.context.removeEventListener('statechange', state)
        source.onended = null
        source.stop()
        source.disconnect()
        if (this.source === source) this.source = null
        gain.disconnect()
        if (this.gain === gain) this.gain = null
        if (error) reject(error)
        else resolve()
      }
      const abort = () => settle(new Error('La celebración se interrumpió.'))
      const state = () => {
        if (this.context.state !== 'running' || performance.now() >= this.wallPermitUntil) abort()
      }
      const timer = setTimeout(() => settle(new Error('El audio no confirmó su finalización.')), asset.durationMs + 5000)
      const startedAt = this.context.currentTime
      source.onended = () => settle(this.permitUntil < startedAt + buffer.duration - 0.1 ? new Error('El permiso de audio venció antes de terminar la etapa.') : undefined)
      signal.addEventListener('abort', abort, { once: true })
      this.context.addEventListener('statechange', state)
      source.start()
      source.stop(this.permitUntil)
      onStarted?.(buffer.duration * 1000)
    })
  }
}
