import { clipDurationLimit, type AnimationClip } from '../../../../../shared/animation.js'

/** A finite, isolated voice channel. It never changes music gain or playback. */
export default class AnnouncementAudio {
  context: AudioContext | null = null
  buffers = new Map<string, AudioBuffer>()
  onUnavailable: (() => void) | null = null
  onAvailable: (() => void) | null = null
  private stopSource: (() => void) | null = null
  private finishSource: (() => void) | null = null
  private renewSource: ((milliseconds: number, loop?: boolean) => boolean) | null = null
  private gain: GainNode | null = null
  private generation = 0
  private preparing: Promise<string[]> = Promise.resolve([])
  private playingChecksum: string | null = null
  readonly maxDecodedBytes = 64 * 1024 * 1024

  get decodedBytes () { return [...this.buffers.values()].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0) }

  private ensureContext () {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    const context = this.context
    context.onstatechange = () => {
      if (this.context !== context) return
      if (this.ready) this.onAvailable?.()
      else this.onUnavailable?.()
    }
    return context
  }

  async resume () {
    const context = this.ensureContext()
    const generation = this.generation
    // Chromium can leave resume pending until a gesture. Bound each attempt so
    // ordinary player interactions cannot accumulate unresolved subscriptions.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        context.resume(),
        new Promise<never>((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('El navegador no habilitó el audio')), 750)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    if (this.context !== context || generation !== this.generation) throw new Error('La preparación de audio fue cancelada')
    if (context.state !== 'running') throw new Error('El navegador no habilitó el audio')
  }

  async unlock (clips: AnimationClip[]) {
    await this.resume()
    return this.prepare(clips)
  }

  // Decoding does not require autoplay permission; prepare before a possible gesture.
  async prepare (clips: AnimationClip[]) {
    const context = this.ensureContext()
    const generation = this.generation
    const assertCurrent = () => {
      if (this.context !== context || generation !== this.generation || context.state === 'closed') {
        throw new Error('La preparación de audio fue cancelada')
      }
    }
    assertCurrent()
    const prepare = async () => {
      assertCurrent()
      const desired = new Set(clips.slice(0, 24).map(clip => clip.checksum))
      for (const hash of this.buffers.keys()) {
        if (!desired.has(hash) && hash !== this.playingChecksum) this.buffers.delete(hash)
      }
      const retained = new Set<string>()
      for (const clip of clips.slice(0, 24)) {
        if (this.buffers.has(clip.checksum)) {
          retained.add(clip.checksum)
          continue
        }
        const response = await fetch(`${document.baseURI}api/animation/assets/${encodeURIComponent(clip.id)}`)
        assertCurrent()
        if (!response.ok) throw new Error('No se pudo descargar el clip')
        const bytes = await response.arrayBuffer()
        const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
        if (checksum !== clip.checksum) throw new Error('La versión del clip cambió')
        assertCurrent()
        const buffer = await context.decodeAudioData(bytes)
        assertCurrent()
        if (buffer.duration <= 0 || buffer.duration * 1000 > clipDurationLimit(clip.kind, clip.effectType) || Math.abs(buffer.duration * 1000 - clip.durationMs) > 100) throw new Error('La duración del clip no es válida')
        const size = buffer.length * buffer.numberOfChannels * 4
        if (size > this.maxDecodedBytes) throw new Error('El audio supera la memoria disponible para este canal.')
        for (const hash of this.buffers.keys()) {
          if (this.decodedBytes + size <= this.maxDecodedBytes) break
          if (hash !== this.playingChecksum && !retained.has(hash)) this.buffers.delete(hash)
        }
        if (this.decodedBytes + size > this.maxDecodedBytes) continue
        this.buffers.set(clip.checksum, buffer)
        retained.add(clip.checksum)
      }
      return [...this.buffers.keys()]
    }
    this.preparing = this.preparing.catch((): string[] => []).then(prepare)
    return this.preparing
  }

  get ready () { return this.context?.state === 'running' }

  play (checksum: string, volume: number, segment?: { offsetMs: number, durationMs: number, renewable?: boolean, loop?: boolean }): Promise<'ENDED' | 'STOPPED'> {
    const context = this.context
    const buffer = this.buffers.get(checksum)
    if (!context || context.state !== 'running' || !buffer || this.stopSource) throw new Error('El canal de voz no está disponible')
    const offset = Math.max(0, (segment?.offsetMs ?? 0) / 1000)
    const duration = segment?.renewable ? buffer.duration - offset : Math.min(buffer.duration - offset, (segment?.durationMs ?? buffer.duration * 1000) / 1000)
    if (duration <= 0 || (segment?.renewable && (!Number.isFinite(segment.durationMs) || segment.durationMs <= 0))) throw new Error('Tramo de audio no válido')
    this.playingChecksum = checksum
    return new Promise((resolve) => {
      const source = context.createBufferSource()
      const gain = context.createGain()
      this.gain = gain
      source.buffer = buffer
      source.loop = segment?.renewable === true && segment.loop === true
      gain.gain.value = volume
      source.connect(gain).connect(context.destination)
      let stopped = false
      let settled = false
      let watchdog: ReturnType<typeof setTimeout>
      let leaseEnd = 0
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        context.removeEventListener('statechange', stateChanged)
        source.disconnect()
        gain.disconnect()
        source.onended = null
        this.stopSource = null
        this.finishSource = null
        this.renewSource = null
        this.gain = null
        this.playingChecksum = null
        resolve(stopped ? 'STOPPED' : 'ENDED')
      }
      const stop = () => {
        if (settled || stopped) return
        stopped = true
        gain.gain.cancelScheduledValues(context.currentTime)
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.03)
        source.stop(context.currentTime + 0.03)
        // A suspended context must not resurrect this source when resumed.
        if (context.state !== 'running') {
          source.disconnect()
          finish()
        }
      }
      const stateChanged = () => {
        if (context.state !== 'running') stop()
      }
      const renew = (milliseconds: number, loop?: boolean) => {
        if (stopped || settled || !Number.isFinite(milliseconds) || milliseconds <= 0 || (leaseEnd && context.currentTime >= leaseEnd)) return false
        if (loop !== undefined) source.loop = loop
        clearTimeout(watchdog)
        leaseEnd = context.currentTime + milliseconds / 1000
        source.stop(leaseEnd)
        watchdog = setTimeout(stop, milliseconds + 100)
        return true
      }
      source.onended = () => {
        if (segment?.renewable && context.currentTime >= leaseEnd - 0.001) stopped = true
        finish()
      }
      context.addEventListener('statechange', stateChanged)
      this.stopSource = stop
      this.finishSource = finish
      if (segment?.renewable) {
        source.start(0, offset)
        this.renewSource = renew
        if (!renew(segment.durationMs)) stop()
      } else {
        watchdog = setTimeout(stop, duration * 1000 + 100)
        source.start(0, offset, duration)
        source.stop(context.currentTime + duration)
      }
    })
  }

  stop () { this.stopSource?.() }
  renewAmbience (milliseconds: number, loop?: boolean) { return this.renewSource?.(milliseconds, loop) ?? false }

  volume (value: number) {
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.02)
  }

  close () {
    this.stop()
    // Closing the context may prevent a scheduled `ended` event altogether.
    // Resolve the owned playback before disposing its audio clock.
    this.finishSource?.()
    const context = this.context
    this.generation++
    this.context = null
    this.buffers.clear()
    if (context && context.state !== 'closed') {
      context.onstatechange = null
      void context.close().catch((error) => {
        if (context.state !== 'closed') console.error('Could not release announcement audio context', error)
      })
    }
  }
}
