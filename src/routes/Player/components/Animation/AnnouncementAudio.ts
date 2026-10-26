import type { AnimationClip } from 'shared/animation'

/** A finite, isolated voice channel. It never changes music gain or playback. */
export default class AnnouncementAudio {
  context: AudioContext | null = null
  buffers = new Map<string, AudioBuffer>()
  onUnavailable: (() => void) | null = null
  private stopSource: (() => void) | null = null
  private finishSource: (() => void) | null = null
  private gain: GainNode | null = null
  private generation = 0

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
    for (const clip of clips) {
      if (this.buffers.has(clip.checksum)) continue
      const response = await fetch(`${document.baseURI}api/animation/assets/${encodeURIComponent(clip.id)}`)
      assertCurrent()
      if (!response.ok) throw new Error('No se pudo descargar el clip')
      const bytes = await response.arrayBuffer()
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      if (checksum !== clip.checksum) throw new Error('La versión del clip cambió')
      assertCurrent()
      const buffer = await context.decodeAudioData(bytes)
      assertCurrent()
      if (buffer.duration <= 0 || buffer.duration > 10 || Math.abs(buffer.duration * 1000 - clip.durationMs) > 100) throw new Error('La duración del clip no es válida')
      this.buffers.set(clip.checksum, buffer)
    }
    return [...this.buffers.keys()]
  }

  get ready () { return this.context?.state === 'running' }

  play (checksum: string, volume: number): Promise<'ENDED' | 'STOPPED'> {
    const context = this.context
    const buffer = this.buffers.get(checksum)
    if (!context || context.state !== 'running' || !buffer || this.stopSource) throw new Error('El canal de voz no está disponible')
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
      const watchdog = setTimeout(stop, buffer.duration * 1000 + 100)
      source.onended = finish
      context.addEventListener('statechange', stateChanged)
      this.stopSource = stop
      this.finishSource = finish
      source.start()
      source.stop(context.currentTime + buffer.duration)
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
