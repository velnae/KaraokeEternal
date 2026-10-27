import { clipDurationLimit, type AnimationClip } from '../../../../../shared/animation.js'

/** A finite, isolated voice channel. It never changes music gain or playback. */
export default class AnnouncementAudio {
  context: AudioContext | null = null
  buffers = new Map<string, AudioBuffer>()
  onUnavailable: (() => void) | null = null
  private stopSource: (() => void) | null = null
  private finishSource: (() => void) | null = null
  private gain: GainNode | null = null
  private generation = 0
  private preparing: Promise<string[]> = Promise.resolve([])
  private playingChecksum: string | null = null
  readonly maxDecodedBytes = 32 * 1024 * 1024

  get decodedBytes () { return [...this.buffers.values()].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0) }

  async unlock (clips: AnimationClip[]) {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    const context = this.context
    const generation = this.generation
    const assertCurrent = () => {
      if (this.context !== context || generation !== this.generation || context.state === 'closed') {
        throw new Error('La preparación de audio fue cancelada')
      }
    }
    context.onstatechange = () => {
      if (!this.ready) this.onUnavailable?.()
    }
    await context.resume()
    assertCurrent()
    if (context.state !== 'running') throw new Error('El navegador no habilitó el audio')
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
        if (buffer.duration <= 0 || buffer.duration * 1000 > clipDurationLimit(clip.kind) || Math.abs(buffer.duration * 1000 - clip.durationMs) > 100) throw new Error('La duración del clip no es válida')
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

  play (checksum: string, volume: number, segment?: { offsetMs: number, durationMs: number }): Promise<'ENDED' | 'STOPPED'> {
    const context = this.context
    const buffer = this.buffers.get(checksum)
    if (!context || context.state !== 'running' || !buffer || this.stopSource) throw new Error('El canal de voz no está disponible')
    const offset = Math.max(0, (segment?.offsetMs ?? 0) / 1000)
    const duration = Math.min(buffer.duration - offset, (segment?.durationMs ?? buffer.duration * 1000) / 1000)
    if (duration <= 0) throw new Error('Tramo de audio no válido')
    this.playingChecksum = checksum
    return new Promise((resolve) => {
      const source = context.createBufferSource()
      const gain = context.createGain()
      this.gain = gain
      source.buffer = buffer
      gain.gain.value = volume
      source.connect(gain).connect(context.destination)
      let stopped = false
      let settled = false
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
      const watchdog = setTimeout(stop, duration * 1000 + 100)
      source.onended = finish
      context.addEventListener('statechange', stateChanged)
      this.stopSource = stop
      this.finishSource = finish
      source.start(0, offset, duration)
      source.stop(context.currentTime + duration)
    })
  }

  stop () { this.stopSource?.() }

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
