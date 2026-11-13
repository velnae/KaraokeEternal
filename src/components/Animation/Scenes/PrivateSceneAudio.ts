import { sceneCueTitle, type ResolvedSceneCue, type SceneResource } from 'shared/eventScenes'

/** Private transport. No public reservations, receipts or synthesis requests. */
export default class PrivateSceneAudio {
  private context: AudioContext | null = null
  private cache = new Map<string, AudioBuffer>()
  private nodes: AudioBufferSourceNode[] = []
  private origin = 0
  private generation = 0
  private bytes = 0

  async resume () {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext()
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Active el sonido del navegador y vuelva a reproducir.')
  }

  private async buffer (resource: SceneResource): Promise<AudioBuffer> {
    const key = JSON.stringify([resource.url, resource.checksum, resource.parts])
    const cached = this.cache.get(key)
    if (cached) return cached
    const context = this.context!
    let buffer: AudioBuffer
    if (resource.parts?.length) {
      const parts = []
      for (const part of resource.parts) parts.push(await this.buffer(part))
      buffer = context.createBuffer(Math.max(...parts.map(part => part.numberOfChannels)), parts.reduce((sum, part) => sum + part.length, 0), context.sampleRate)
      let offset = 0
      for (const part of parts) {
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) buffer.getChannelData(channel).set(part.getChannelData(Math.min(channel, part.numberOfChannels - 1)), offset)
        offset += part.length
      }
    } else {
      if (!resource.url?.startsWith('api/')) throw new Error('Seleccione un audio de la biblioteca para la prueba.')
      const response = await fetch(new URL(resource.url, document.baseURI), { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('No se pudo abrir un audio de prueba. Revise el recurso seleccionado.')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('El archivo de prueba supera el tamaño permitido.')
      if (resource.checksum) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
        if (hash !== resource.checksum) throw new Error('El recurso cambió. Actualice los recursos y vuelva a previsualizar.')
      }
      buffer = await context.decodeAudioData(bytes)
    }
    const size = buffer.length * buffer.numberOfChannels * 4
    if (this.bytes + size > 256 * 1024 * 1024) throw new Error('La prueba supera la memoria disponible. Use menos audios o la vista solo visual.')
    this.cache.set(key, buffer)
    this.bytes += size
    return buffer
  }

  async prepare (cues: ResolvedSceneCue[]) {
    const generation = ++this.generation
    const keep = new Set<string>()
    const retain = (resource: SceneResource) => {
      keep.add(JSON.stringify([resource.url, resource.checksum, resource.parts]))
      resource.parts?.forEach(retain)
    }
    cues.filter(cue => ['voice', 'ambience'].includes(cue.lane)).forEach((cue) => {
      if (cue.resource) retain(cue.resource)
    })
    for (const [key, buffer] of this.cache) {
      if (keep.has(key)) continue
      this.cache.delete(key)
      this.bytes -= buffer.length * buffer.numberOfChannels * 4
    }
    for (const cue of cues) {
      if (generation !== this.generation) return false
      if (['voice', 'ambience'].includes(cue.lane) && cue.resource) {
        try {
          await this.buffer(cue.resource)
        } catch (error) { throw new Error(`${sceneCueTitle(cue)}: ${(error as Error).message}`) }
      }
    }
    return generation === this.generation
  }

  start (cues: ResolvedSceneCue[], timeMs: number) {
    this.stop()
    const context = this.context!
    this.origin = context.currentTime - timeMs / 1000
    for (const cue of cues) {
      if (!['voice', 'ambience'].includes(cue.lane) || !cue.resource || cue.endMs <= timeMs) continue
      const buffer = this.cache.get(JSON.stringify([cue.resource.url, cue.resource.checksum, cue.resource.parts]))
      if (!buffer) continue
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = buffer
      source.loop = cue.lane === 'ambience'
      source.connect(gain).connect(context.destination)
      const when = context.currentTime + Math.max(0, cue.startMs - timeMs) / 1000
      const offset = Math.max(0, timeMs - cue.startMs) / 1000
      const duration = (cue.endMs - Math.max(timeMs, cue.startMs)) / 1000
      const fullDuration = (cue.endMs - cue.startMs) / 1000
      const fade = Math.min(cue.fadeMs / 1000, fullDuration / 2)
      const level = (position: number) => cue.volume * (fade > 0 ? Math.max(0, Math.min(1, position / fade, (fullDuration - position) / fade)) : 1)
      gain.gain.setValueAtTime(level(offset), when)
      for (const position of [fade, fullDuration - fade, fullDuration]) {
        if (position > offset) gain.gain.linearRampToValueAtTime(level(position), when + position - offset)
      }
      if (!source.loop && offset >= buffer.duration) {
        source.disconnect()
        gain.disconnect()
        continue
      }
      source.start(when, source.loop ? offset % buffer.duration : offset)
      source.stop(when + duration)
      source.onended = () => {
        source.disconnect()
        gain.disconnect()
        this.nodes = this.nodes.filter(node => node !== source)
      }
      this.nodes.push(source)
    }
  }

  position () { return Math.max(0, ((this.context?.currentTime ?? 0) - this.origin) * 1000) }
  stop () {
    this.generation++
    for (const node of this.nodes) node.stop()
    this.nodes = []
  }

  close () {
    this.stop()
    this.cache.clear()
    this.bytes = 0
    void this.context?.close().catch(() => {})
    this.context = null
  }
}
