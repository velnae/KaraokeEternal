import { birthdayLimits, type BirthdayAsset } from '../../../../../shared/birthdays.js'

export class BirthdayAudio {
  private bytes = new Map<string, ArrayBuffer>()
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private permitUntil = 0
  private wallPermitUntil = 0
  constructor (private context: AudioContext) {}

  volume (value: number) { this.gain?.gain.setValueAtTime(value, this.context.currentTime) }

  // Schedule on the audio clock: background-tab timers cannot extend authority.
  permitFor (milliseconds: number) {
    if (this.source && (this.context.currentTime >= this.permitUntil || performance.now() >= this.wallPermitUntil)) return
    const duration = Math.max(0, milliseconds) / 1000
    this.permitUntil = this.context.currentTime + duration
    this.wallPermitUntil = performance.now() + Math.max(0, milliseconds)
    this.source?.stop(this.permitUntil)
  }

  async prepare (assets: BirthdayAsset[], signal: AbortSignal) {
    for (const asset of assets.filter(item => item.kind !== 'video')) {
      if (!asset.url.startsWith('api/birthdays/assets/')) throw new Error('Recurso de cumpleaños inválido.')
      const response = await fetch(new URL(asset.url, document.baseURI), { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error('No se pudo descargar el audio del cumpleaños.')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('El audio excede el tamaño permitido.')
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      if (hash !== asset.checksum) throw new Error('El audio del cumpleaños cambió. Vuelva a prepararlo.')
      this.bytes.set(asset.id, bytes)
    }
  }

  async play (asset: BirthdayAsset, volume: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const bytes = this.bytes.get(asset.id)
    if (!bytes) throw new Error('El audio no está preparado.')
    const buffer = await this.context.decodeAudioData(bytes)
    this.bytes.delete(asset.id)
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
    })
  }
}
