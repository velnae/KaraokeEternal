import { birthdayLimits, birthdayTiming, type BirthdayAsset, type BirthdayPhase } from '../../../../../shared/birthdays.js'

const fadeSeconds = { bedOut: 1.5, musicIn: 1, musicOut: 1.5, applauseIn: 0.5 }

export class BirthdayAudio {
  private buffers = new Map<string, AudioBuffer>()
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private permitUntil = 0
  private wallPermitUntil = 0
  private bed: { source: AudioBufferSourceNode, gain: GainNode, end: number, cleanup(): void } | null = null
  private bedAsset?: BirthdayAsset
  private bedVolume = 0.2
  private masterVolume = 1
  private bedDuration = 0
  private stopVoice?: () => void
  private foreground: { gain: GainNode, phase: BirthdayPhase, start: number, end: number } | null = null
  private media: { element: HTMLMediaElement, source: MediaElementAudioSourceNode, gain: GainNode } | null = null
  warning = ''
  constructor (private context: AudioContext, private localPreview = false, private choreographyVersion?: 1) {}
  available (asset: BirthdayAsset) { return this.buffers.has(asset.id) }

  volume (value: number) {
    this.masterVolume = value
    if (this.foreground) this.updateForegroundGain()
    else this.gain?.gain.setValueAtTime(value, this.context.currentTime)
    this.updateBedGain()
  }

  // Schedule on the audio clock: background-tab timers cannot extend authority.
  permitFor (milliseconds: number) {
    if ((this.source || this.bed) && (this.context.currentTime >= this.permitUntil || performance.now() >= this.wallPermitUntil)) return
    const duration = Math.max(0, milliseconds) / 1000
    this.permitUntil = this.context.currentTime + duration
    this.wallPermitUntil = performance.now() + Math.max(0, milliseconds)
    this.source?.stop(this.permitUntil)
    this.bed?.source.stop(Math.min(this.permitUntil, this.bed.end))
  }

  async prepare (assets: BirthdayAsset[], signal: AbortSignal, bedVolume = 0.2) {
    this.bedVolume = bedVolume
    for (const asset of assets.filter(item => item.kind !== 'video')) {
      try {
        if (!asset.url.startsWith('api/birthdays/assets/')) throw new Error('Recurso de cumpleaños inválido.')
        const response = await fetch(new URL(asset.url, document.baseURI), { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw new Error('No se pudo descargar el audio del cumpleaños.')
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('El audio excede el tamaño permitido.')
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
        if (hash !== asset.checksum) throw new Error('El audio del cumpleaños cambió. Vuelva a prepararlo.')
        const buffer = await this.context.decodeAudioData(bytes)
        signal.throwIfAborted()
        const limit = asset.kind === 'music' ? birthdayLimits.musicMs : asset.kind === 'bed' ? birthdayLimits.bedMs : asset.kind === 'applause' ? birthdayLimits.applauseMs : birthdayLimits.voiceMs
        if (buffer.duration <= 0 || buffer.duration * 1000 > limit + 100 || Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('La duración del audio no coincide con el evento.')
        this.buffers.set(asset.id, buffer)
        if (asset.kind === 'bed') this.bedAsset = asset
      } catch (error) {
        signal.throwIfAborted()
        if (!['bed', 'applause'].includes(asset.kind)) throw error
        this.warning += asset.kind === 'bed' ? 'No se pudo preparar el audio de fondo. La celebración continúa sin acompañamiento. ' : 'No se pudo preparar el aplauso. La celebración continúa sin ese efecto. '
      }
    }
    this.bedDuration = assets.filter(asset => asset.kind === 'intro' || asset.kind === 'greeting').reduce((sum, asset) => sum + (this.buffers.get(asset.id)?.duration ?? 0), 0)
    if (this.choreographyVersion) this.bedDuration += (birthdayTiming.preludeMs + birthdayTiming.bridgeMs) / 1000
  }

  stopBed () {
    this.bed?.cleanup()
  }

  stop () {
    this.stopVoice?.()
    this.stopBed()
    this.media?.source.disconnect()
    this.media?.gain.disconnect()
    this.media = null
    this.foreground = null
    this.gain = null
  }

  // Keep native media controls while using the same envelope as public playback.
  mediaPhase (asset: BirthdayAsset, element: HTMLMediaElement) {
    if (this.media?.element !== element) {
      this.media?.source.disconnect()
      this.media?.gain.disconnect()
      const source = this.context.createMediaElementSource(element)
      const gain = this.context.createGain()
      gain.gain.value = 0
      source.connect(gain).connect(this.context.destination)
      this.media = { element, source, gain }
    }
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : asset.durationMs / 1000
    const start = this.context.currentTime - element.currentTime
    this.gain = this.media.gain
    this.foreground = { gain: this.media.gain, phase: asset.kind as BirthdayPhase, start, end: start + duration }
    this.updateForegroundGain()
  }

  private updateForegroundGain () {
    if (!this.foreground) return
    const { gain, phase, start, end } = this.foreground
    const now = this.context.currentTime
    const duration = Math.max(0, end - start)
    const fadeIn = phase === 'music' ? fadeSeconds.musicIn : phase === 'applause' ? fadeSeconds.applauseIn : 0
    const fadeOut = phase === 'music' ? fadeSeconds.musicOut : 0
    // Short clips still reach their intended level without overlapping ramps.
    const scale = Math.min(1, duration / (fadeIn + fadeOut || 1))
    const incoming = fadeIn * scale
    const outgoing = fadeOut * scale
    if (!incoming && !outgoing) {
      gain.gain.setValueAtTime(this.masterVolume, now)
      return
    }
    const level = Math.min(1, incoming ? Math.max(0, (now - start) / incoming) : 1,
      outgoing ? Math.max(0, (end - now) / outgoing) : 1)
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(this.masterVolume * level, now)
    if (now < start + incoming) gain.gain.linearRampToValueAtTime(this.masterVolume, start + incoming)
    if (outgoing) {
      if (now < end - outgoing) gain.gain.setValueAtTime(this.masterVolume, end - outgoing)
      if (now < end) gain.gain.linearRampToValueAtTime(0, end)
    }
  }

  backgroundPhase (phase: BirthdayPhase, volume: number, remainingMs: number, signal: AbortSignal) {
    signal.throwIfAborted()
    this.masterVolume = volume
    if (phase === 'music' || phase === 'applause') return this.stopBed()
    const when = this.context.currentTime
    if (!this.bed) this.startBed(when, signal)
    if ((phase === 'greeting' || phase === 'bridge') && this.bed) {
      this.bed.end = when + remainingMs / 1000 + (phase === 'greeting' && this.choreographyVersion ? birthdayTiming.bridgeMs / 1000 : 0)
      this.updateBedGain()
      this.bed.source.stop(Math.min(this.permitUntil, this.bed.end))
    }
  }

  private updateBedGain (fadeIn = false) {
    if (!this.bed) return
    const now = this.context.currentTime
    const { gain, end } = this.bed
    const volume = this.masterVolume * this.bedVolume
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(fadeIn ? 0 : volume * Math.min(1, Math.max(0, (end - now) / fadeSeconds.bedOut)), now)
    if (fadeIn) gain.gain.linearRampToValueAtTime(volume, Math.min(end, now + 0.2))
    if (now < end - fadeSeconds.bedOut) gain.gain.setValueAtTime(volume, end - fadeSeconds.bedOut)
    gain.gain.linearRampToValueAtTime(0, end)
  }

  private startBed (when: number, signal: AbortSignal) {
    if (!this.bedAsset || this.bedVolume <= 0) return
    const buffer = this.buffers.get(this.bedAsset.id)
    if (!buffer) return
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    source.buffer = buffer
    source.loop = true
    source.connect(gain).connect(this.context.destination)
    // Refined to the greeting's actual start below; never allowed into final music.
    const cleanup = () => {
      if (this.bed?.source !== source) return
      this.bed = null
      source.onended = null
      source.stop()
      source.disconnect()
      gain.disconnect()
      signal.removeEventListener('abort', cleanup)
      this.context.removeEventListener('statechange', state)
    }
    const state = () => {
      if (this.context.state !== 'running' && !(this.localPreview && this.context.state === 'suspended')) cleanup()
    }
    this.bed = { source, gain, end: when + this.bedDuration, cleanup }
    source.onended = cleanup
    signal.addEventListener('abort', cleanup, { once: true })
    this.context.addEventListener('statechange', state)
    this.updateBedGain(true)
    source.start(when)
    source.stop(Math.min(this.permitUntil, this.bed.end))
  }

  async play (asset: BirthdayAsset, volume: number, signal: AbortSignal, onStarted?: () => void) {
    signal.throwIfAborted()
    const buffer = this.buffers.get(asset.id)
    if (!buffer) throw new Error('El audio no está preparado.')
    signal.throwIfAborted()
    const limit = asset.kind === 'music' ? birthdayLimits.musicMs : asset.kind === 'applause' ? birthdayLimits.applauseMs : birthdayLimits.voiceMs
    if (buffer.duration * 1000 > limit + 100 || Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('La duración del audio no coincide con el evento.')
    this.backgroundPhase(asset.kind as BirthdayPhase, volume, buffer.duration * 1000, signal)
    return this.playBuffer(buffer, volume, signal, onStarted, asset.kind as BirthdayPhase)
  }

  async wait (milliseconds: number, signal: AbortSignal) {
    if (milliseconds <= 0) return
    // A silent source follows the same audio clock as the bed and pauses with it.
    const buffer = this.context.createBuffer(1, Math.ceil(milliseconds * this.context.sampleRate / 1000), this.context.sampleRate)
    return this.playBuffer(buffer, 0, signal)
  }

  private async playBuffer (buffer: AudioBuffer, volume: number, signal: AbortSignal, onStarted?: () => void, phase?: BirthdayPhase) {
    signal.throwIfAborted()
    if (this.context.state !== 'running') throw new Error('Active el sonido del reproductor y vuelva a programar el evento.')
    if (this.permitUntil <= this.context.currentTime || this.wallPermitUntil <= performance.now()) throw new Error('El permiso de reproducción venció. Vuelva a programar el cumpleaños.')
    await new Promise<void>((resolve, reject) => {
      const source = this.context.createBufferSource()
      const when = this.context.currentTime
      this.source = source
      const gain = this.context.createGain()
      this.gain = gain
      source.buffer = buffer
      gain.gain.value = phase ? 0 : volume
      this.foreground = phase ? { gain, phase, start: when, end: when + buffer.duration } : null
      this.updateForegroundGain()
      source.connect(gain).connect(this.context.destination)
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.stopVoice = undefined
        this.context.removeEventListener('statechange', state)
        source.onended = null
        source.stop()
        source.disconnect()
        if (this.source === source) this.source = null
        gain.disconnect()
        if (this.gain === gain) this.gain = null
        if (this.foreground?.gain === gain) this.foreground = null
        if (error) {
          this.stopBed()
          reject(error)
        } else resolve()
      }
      const abort = () => settle(new Error('La celebración se interrumpió.'))
      this.stopVoice = abort
      const state = () => {
        if ((this.context.state !== 'running' && !(this.localPreview && this.context.state === 'suspended')) || performance.now() >= this.wallPermitUntil) abort()
      }
      const timer = this.localPreview ? undefined : setTimeout(() => settle(new Error('El audio no confirmó su finalización.')), buffer.duration * 1000 + 5000)
      const startedAt = this.context.currentTime
      source.onended = () => settle(this.permitUntil < startedAt + buffer.duration - 0.1 ? new Error('El permiso de audio venció antes de terminar la etapa.') : undefined)
      signal.addEventListener('abort', abort, { once: true })
      this.context.addEventListener('statechange', state)
      source.start(when)
      source.stop(this.permitUntil)
      onStarted?.()
    })
  }
}
