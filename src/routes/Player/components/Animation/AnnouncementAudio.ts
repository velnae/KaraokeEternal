import { clipDurationLimit, TRANSITION_BED_MS, type AnimationClip } from '../../../../../shared/animation.js'
import type { GreetingAsset } from '../../../../../shared/greetings.js'
import { nextTraceIdentity, tracePlayback } from '../../../../lib/playbackTrace'

/** A finite, isolated voice channel. It never changes music gain or playback. */
export default class AnnouncementAudio {
  readonly traceChannelId = nextTraceIdentity()
  context: AudioContext | null = null
  buffers = new Map<string, AudioBuffer>()
  onUnavailable: (() => void) | null = null
  onAvailable: (() => void) | null = null
  private stopSource: ((reason?: string) => void) | null = null
  private finishSource: (() => void) | null = null
  private renewSource: ((milliseconds: number, loop?: boolean) => boolean) | null = null
  private gain: GainNode | null = null
  private generation = 0
  private preparing: Promise<string[]> = Promise.resolve([])
  private playingChecksum: string | null = null
  private catalogKeys = new Set<string>()
  private greetingKeys = new Set<string>()
  private callKeys = new Set<string>()
  private bedChecksum: string | null = null
  private bedStop: ((fadeMs: number) => void) | null = null
  private bedFinish: (() => void) | null = null
  private bedVolumeChange: ((volume: number) => void) | null = null
  private bedCompletion: Promise<'ENDED' | 'STOPPED'> | null = null
  private ambienceHeld = false
  readonly maxDecodedBytes = 64 * 1024 * 1024

  get decodedBytes () { return [...this.buffers.values()].reduce((total, buffer) => total + buffer.length * buffer.numberOfChannels * 4, 0) }
  get hasBed () { return !!this.bedStop }
  get waitingForMusic () { return this.ambienceHeld }

  // A curtain owns the musical handoff, including an empty queue or slow load.
  holdAmbienceUntilMusic () {
    this.ambienceHeld = true
    return this.stopBed(200)
  }

  musicStarted () { this.ambienceHeld = false }
  get readyChecksums () {
    return [...new Set([this.playingChecksum, this.bedChecksum, ...this.callKeys, ...this.greetingKeys, ...this.buffers.keys()])]
      .filter((hash): hash is string => !!hash && this.buffers.has(hash)).slice(0, 30)
  }

  private ensureContext () {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    const context = this.context
    context.onstatechange = () => {
      if (this.context !== context) return
      tracePlayback('audio-context', { channelId: this.traceChannelId, state: context.state })
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
      this.catalogKeys = desired
      for (const hash of this.buffers.keys()) {
        if (!desired.has(hash) && !this.greetingKeys.has(hash) && !this.callKeys.has(hash) && hash !== this.playingChecksum && hash !== this.bedChecksum) this.buffers.delete(hash)
      }
      const retained = new Set<string>()
      for (const clip of clips.slice(0, 24)) {
        if (this.buffers.has(clip.checksum)) {
          retained.add(clip.checksum)
          continue
        }
        const bytes = await this.download(`api/animation/assets/${encodeURIComponent(clip.id)}`)
        assertCurrent()
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
          if (hash !== this.playingChecksum && hash !== this.bedChecksum && !this.greetingKeys.has(hash) && !this.callKeys.has(hash) && !retained.has(hash)) this.buffers.delete(hash)
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

  private async download (url: string) {
    if (!url.startsWith('api/')) throw new Error('Ruta de audio no válida')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(`${document.baseURI}${url}`, { signal: controller.signal })
      if (!response.ok) throw new Error('No se pudo descargar el clip')
      return await response.arrayBuffer()
    } finally { clearTimeout(timeout) }
  }

  /** A separate preparation group keeps catalog refreshes from evicting a greeting. */
  async prepareGreetingAssets (assets: GreetingAsset[], isCurrent = () => true, urgent = false) {
    const context = this.ensureContext()
    const generation = this.generation
    const current = () => isCurrent() && this.context === context && this.generation === generation && context.state !== 'closed'
    const prepare = async () => {
      if (!current()) return []
      const calls = assets.filter(asset => asset.role === 'call').slice(0, 3)
      const greetings = assets.filter(asset => asset.role !== 'call').slice(0, 3)
      const desired = new Set([...calls, ...greetings].map(asset => asset.checksum))
      for (const hash of [...this.greetingKeys, ...this.callKeys]) {
        if (!desired.has(hash) && !this.catalogKeys.has(hash) && hash !== this.playingChecksum && hash !== this.bedChecksum) this.buffers.delete(hash)
      }
      this.callKeys = new Set(calls.map(asset => asset.checksum))
      this.greetingKeys = new Set(greetings.map(asset => asset.checksum))
      const retained = new Set<string>()
      const ordered = [...calls, ...greetings.sort((a, b) => Number(b.role === 'greeting') - Number(a.role === 'greeting'))]
      for (const asset of ordered) {
        let stage = 'download'
        try {
          if (!current()) break
          if (!this.buffers.has(asset.checksum)) {
            const bytes = await this.download(asset.url)
            const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
            if (!current()) break
            stage = 'checksum'
            if (checksum !== asset.checksum) throw new Error('checksum')
            stage = 'decode'
            const buffer = await context.decodeAudioData(bytes)
            if (!current()) break
            const limit = asset.role === 'greeting' ? 20000 : clipDurationLimit(asset.kind, asset.effectType)
            stage = 'duration'
            if (buffer.duration <= 0 || buffer.duration * 1000 > limit || Math.abs(buffer.duration * 1000 - asset.durationMs) > 100) throw new Error('duration')
            const size = buffer.length * buffer.numberOfChannels * 4
            for (const hash of this.buffers.keys()) {
              if (this.decodedBytes + size <= this.maxDecodedBytes) break
              if (hash !== this.playingChecksum && hash !== this.bedChecksum && !this.callKeys.has(hash) && !this.greetingKeys.has(hash) && !retained.has(hash)) this.buffers.delete(hash)
            }
            stage = 'memory'
            if (this.decodedBytes + size > this.maxDecodedBytes) throw new Error('memory')
            this.buffers.set(asset.checksum, buffer)
            tracePlayback('turn-asset-ready', { channelId: this.traceChannelId, checksum: asset.checksum, state: asset.role })
          }
          retained.add(asset.checksum)
        } catch {
          tracePlayback('turn-asset-failed', { channelId: this.traceChannelId, checksum: asset.checksum, state: asset.role, reason: stage })
        }
      }
      return [...retained]
    }
    // A turn must not queue behind a slow, unrelated catalog refresh.
    if (urgent) return prepare()
    this.preparing = this.preparing.catch((): string[] => []).then(prepare)
    return this.preparing
  }

  /** A bounded second source under the voice, never a continuation into the song. */
  playBed (checksum: string, volume: number, durationMs: number, loop = false) {
    const context = this.context
    const buffer = this.buffers.get(checksum)
    if (!context || context.state !== 'running' || !buffer || this.bedStop || this.ambienceHeld || durationMs <= 0) throw new Error('El fondo no está disponible')
    const duration = Math.min(TRANSITION_BED_MS / 1000, durationMs / 1000, loop ? Infinity : buffer.duration)
    const until = context.currentTime + duration
    this.bedChecksum = checksum
    this.bedCompletion = new Promise<'ENDED' | 'STOPPED'>((resolve) => {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = loop
      source.connect(gain).connect(context.destination)
      gain.gain.setValueAtTime(0, context.currentTime)
      gain.gain.linearRampToValueAtTime(volume, Math.min(until, context.currentTime + 0.2))
      gain.gain.setValueAtTime(volume, Math.max(context.currentTime, until - 0.25))
      gain.gain.linearRampToValueAtTime(0, until)
      let settled = false
      let stopped = false
      const timer = setTimeout(() => stop(0), duration * 1000 + 100)
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        context.removeEventListener('statechange', stateChanged)
        source.disconnect()
        gain.disconnect()
        source.onended = null
        this.bedStop = null
        this.bedFinish = null
        this.bedVolumeChange = null
        this.bedChecksum = null
        this.bedCompletion = null
        resolve(stopped ? 'STOPPED' : 'ENDED')
      }
      const stop = (fadeMs: number) => {
        if (settled || stopped) return
        stopped = true
        // Repeated stop() replaces the scheduled deadline; never extend it.
        const end = Math.min(until, context.currentTime + Math.max(0, fadeMs) / 1000)
        gain.gain.cancelScheduledValues(context.currentTime)
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
        gain.gain.linearRampToValueAtTime(0, Math.max(context.currentTime, end))
        source.stop(Math.max(context.currentTime, end))
        if (context.state !== 'running') finish()
      }
      const stateChanged = () => {
        if (context.state !== 'running') stop(0)
      }
      this.bedStop = stop
      this.bedFinish = finish
      this.bedVolumeChange = (value) => {
        if (stopped || settled || context.currentTime >= until - 0.25) return
        gain.gain.cancelScheduledValues(context.currentTime)
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime)
        gain.gain.linearRampToValueAtTime(value, Math.min(until - 0.25, context.currentTime + 0.02))
        gain.gain.setValueAtTime(value, until - 0.25)
        gain.gain.linearRampToValueAtTime(0, until)
      }
      context.addEventListener('statechange', stateChanged)
      source.onended = finish
      source.start()
      source.stop(until)
    })
    return this.bedCompletion
  }

  stopBed (fadeMs = 250) {
    const completion = this.bedCompletion ?? Promise.resolve<'STOPPED'>('STOPPED')
    this.bedStop?.(fadeMs)
    return completion
  }

  bedVolume (value: number) { this.bedVolumeChange?.(value) }

  play (checksum: string, volume: number, segment?: { offsetMs: number, durationMs: number, renewable?: boolean, loop?: boolean }): Promise<'ENDED' | 'STOPPED'> {
    const context = this.context
    const buffer = this.buffers.get(checksum)
    if (!context || context.state !== 'running' || !buffer || this.stopSource) throw new Error('El canal de voz no está disponible')
    if (segment?.renewable && this.ambienceHeld) throw new Error('El ambiente espera a la siguiente canción')
    const offset = Math.max(0, (segment?.offsetMs ?? 0) / 1000)
    const duration = segment?.renewable ? buffer.duration - offset : Math.min(buffer.duration - offset, (segment?.durationMs ?? buffer.duration * 1000) / 1000)
    if (duration <= 0 || (segment?.renewable && (!Number.isFinite(segment.durationMs) || segment.durationMs <= 0))) throw new Error('Tramo de audio no válido')
    this.playingChecksum = checksum
    const runId = nextTraceIdentity()
    const began = performance.now()
    const audioBegan = context.currentTime
    tracePlayback('audio-start', { channelId: this.traceChannelId, runId, checksum, durationMs: duration * 1000, volume })
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
      let stopReason = 'natural-end'
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
        tracePlayback('audio-finish', { channelId: this.traceChannelId, runId, checksum, reason: stopReason,
          state: stopped ? 'STOPPED' : 'ENDED', elapsedMs: performance.now() - began,
          audioElapsedMs: (context.currentTime - audioBegan) * 1000 })
        resolve(stopped ? 'STOPPED' : 'ENDED')
      }
      const stop = (reason = 'explicit-stop') => {
        if (settled || stopped) return
        stopped = true
        stopReason = reason
        tracePlayback('audio-stop-request', { channelId: this.traceChannelId, runId, reason })
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
        if (context.state !== 'running') stop('context-unavailable')
      }
      const renew = (milliseconds: number, loop?: boolean) => {
        if (stopped || settled || !Number.isFinite(milliseconds) || milliseconds <= 0 || (leaseEnd && context.currentTime >= leaseEnd)) return false
        if (loop !== undefined) source.loop = loop
        clearTimeout(watchdog)
        leaseEnd = context.currentTime + milliseconds / 1000
        source.stop(leaseEnd)
        watchdog = setTimeout(() => stop('lease-watchdog'), milliseconds + 100)
        return true
      }
      source.onended = () => {
        if (segment?.renewable && context.currentTime >= leaseEnd - 0.001) {
          stopped = true
          stopReason = 'lease-ended'
        }
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
        watchdog = setTimeout(() => stop('duration-watchdog'), duration * 1000 + 100)
        source.start(0, offset, duration)
        source.stop(context.currentTime + duration)
      }
    })
  }

  stop (reason = 'explicit-stop') {
    this.stopForeground(reason)
    this.bedStop?.(30)
  }

  stopForeground (reason = 'explicit-stop') { this.stopSource?.(reason) }

  renewAmbience (milliseconds: number, loop?: boolean) { return this.renewSource?.(milliseconds, loop) ?? false }

  volume (value: number) {
    if (this.gain && value === 0 && this.gain.gain.value !== 0) tracePlayback('audio-muted', { channelId: this.traceChannelId, volume: value })
    if (this.context && this.gain) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.02)
  }

  close () {
    this.stop('channel-closed')
    // Closing the context may prevent a scheduled `ended` event altogether.
    // Resolve the owned playback before disposing its audio clock.
    this.finishSource?.()
    this.bedFinish?.()
    const context = this.context
    this.generation++
    this.context = null
    this.buffers.clear()
    this.catalogKeys.clear()
    this.greetingKeys.clear()
    this.callKeys.clear()
    if (context && context.state !== 'closed') {
      context.onstatechange = null
      void context.close().catch((error) => {
        if (context.state !== 'closed') console.error('Could not release announcement audio context', error)
      })
    }
  }
}
