import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { CatalogProduction, type ProductionOptions } from './Production.js'
import { loadCatalog, catalogAsset, catalogClips } from './catalog.js'
import type { ProductionInput } from '../../shared/catalogProduction.js'
import { editResource, getResource, resourceDTO } from './Resources.js'
import type { AudioProvider } from './AudioProvider.js'
import * as catalog from './catalog.js'
import { execFileSync } from 'node:child_process'
import { deleteResource } from './deletion.js'

function wav (seconds = 1, silent = false) {
  const samples = Math.round(24000 * seconds)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(48000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(silent ? 0 : Math.round(Math.sin(index * Math.PI * 2 * 440 / 24000) * 5000), 44 + index * 2)
  return buffer
}
let directory: string
let production: CatalogProduction
let provider: ReturnType<typeof createServer>
let options: ProductionOptions
let mode: 'ok' | 'reject' | 'corrupt' | 'silent' | 'long' | 'error' | 'bad-setting' = 'ok'
let requests: { url: string, body: Record<string, unknown> }[]
const published = vi.fn()
const input: ProductionInput = { kind: 'voice', title: 'Welcome', text: 'Bienvenidos a nuestra sala.', family: 'welcome', style: 'warm', voiceId: 'testvoice' }

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-production-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\')')
  await loadCatalog(directory, path.resolve('assets/animation'))
  requests = []
  mode = 'ok'
  published.mockClear()
  provider = createServer(async (req, res) => {
    if (req.headers['xi-api-key'] !== 'test-secret') {
      res.writeHead(401)
      res.end()
      return
    }
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify([{ model_id: 'eleven_v4' }]))
      return
    }
    if (req.url === '/v1/voices') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ voices: [{ voice_id: 'testvoice', name: 'Test voice' }] }))
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url!, body: JSON.parse(Buffer.concat(chunks).toString()) })
    if (mode === 'bad-setting') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ detail: { status: 'invalid_stability', message: 'Echoed sensitive provider detail: test-secret' } }))
      return
    }
    if (mode === 'reject' || mode === 'error') {
      res.writeHead(mode === 'reject' ? 429 : 500)
      res.end('provider error')
      return
    }
    res.setHeader('request-id', 'provider-request')
    res.setHeader('Content-Type', 'audio/wav')
    res.end(mode === 'corrupt' ? Buffer.from('invalid') : wav(mode === 'long' ? 11 : 1, mode === 'silent'))
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address() as { port: number }
  options = { key: 'test-secret', baseUrl: `http://127.0.0.1:${address.port}`, model: 'eleven_v4', voiceId: 'testvoice',
    characterLimit: 10000, effectSecondsLimit: 300, pricePerThousandCharacters: 0.1, pricePerEffectSecond: 0.02, ffmpeg: 'ffmpeg' }
  production = new CatalogProduction(directory, options, published)
  await production.start()
  await production.check()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await production.stop()
  await new Promise<void>(resolve => provider.close(() => resolve()))
  close()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('catalog production', () => {
  it('accepts local ambience up to 35 seconds while enforcing the provider generation maximum', async () => {
    const ambience = await production.upload(1, 'uploaded-long-ambience', 'ambience', 'Ambiente', { loop: true }, wav(34), 'ambience.wav')
    expect(ambience.preparation).toBe('ready')
    const replaced = await production.replaceUpload(1, ambience.id, wav(34.8), 'longer.wav')
    expect(replaced.durationMs).toBeGreaterThan(34000)
    expect(replaced.durationMs).toBeLessThanOrEqual(35000)
    await expect(production.replaceUpload(1, ambience.id, wav(35.1), 'too-long.wav')).rejects.toThrow('35 s')
    await loadCatalog(directory)
    expect(getResource(ambience.id)?.preparation).toBe('ready')
    expect(requests).toHaveLength(0)
    expect(() => production.enqueue(1, 1, [{ ...input, kind: 'ambience', durationSeconds: 35 }])).toThrow('máximo 30 s')
    production.enqueue(1, 1, [{ ...input, kind: 'ambience', durationSeconds: 30 }])
    await production.drain()
    expect(requests).toHaveLength(1)
    expect(requests[0].body.duration_seconds).toBe(30)
  })

  it('supports a long transition upload and replacement without widening short effects or automatic celebrations', async () => {
    const direct = await production.upload(1, 'uploaded-direct-transition', 'effect', 'Cortina', { effectType: 'transition', family: 'celebration' }, wav(6), 'transition.wav')
    expect(direct).toMatchObject({ preparation: 'ready', metadata: { effectType: 'transition', family: 'manual' } })
    const failed = await production.upload(1, 'uploaded-transition', 'effect', 'Separador', { family: 'celebration', category: 'Separador musical' }, wav(8), 'transition.wav')
    expect(failed.preparation).toBe('failed')
    const transition = await production.replaceUpload(1, failed.id, wav(11.9), 'transition.wav', 'transition')
    expect(transition).toMatchObject({ preparation: 'ready', metadata: { effectType: 'transition', family: 'manual' } })
    expect(transition.durationMs).toBeGreaterThan(10000)
    expect(transition.durationMs).toBeLessThanOrEqual(12000)
    expect(catalogAsset(failed.id)?.clip).toMatchObject({ effectType: 'transition', approvedForAuto: true, family: 'manual' })
    await loadCatalog(directory)
    expect(getResource(failed.id)?.preparation).toBe('ready')
    expect(() => editResource(1, failed.id, { metadata: { effectType: 'short' } })).toThrow('Reemplazar archivo')
    await expect(production.replaceUpload(1, failed.id, wav(12.1), 'long.wav', 'transition')).rejects.toThrow('12 s')
    await expect(production.replaceUpload(1, failed.id, wav(8), 'short.wav', 'short')).rejects.toThrow('4.5 s')
    expect(getResource(failed.id)?.checksum).toBe(transition.checksum)
    const short = await production.replaceUpload(1, failed.id, wav(2), 'short.wav', 'short')
    expect(short.metadata.effectType).toBe('short')
    expect(requests).toHaveLength(0)
  })

  it('generates transitions with distinct cache identity while legacy short requests remain deduplicated', async () => {
    const effect = { ...input, kind: 'effect' as const, text: 'Warm musical transition.', durationSeconds: 2, category: 'Celebración' }
    const [legacy] = production.enqueue(1, 1, [effect])
    const [short] = production.enqueue(1, 1, [{ ...effect, category: 'celebration', effectType: 'short' }])
    expect(short.jobId).toBe(legacy.jobId)
    const [transition] = production.enqueue(1, 1, [{ ...effect, effectType: 'transition', durationSeconds: 12 }])
    await production.drain()
    expect(requests).toHaveLength(2)
    expect(requests[1].body).toMatchObject({ duration_seconds: 12 })
    expect(catalogAsset(`generated-${transition.jobId}`)?.clip).toMatchObject({ effectType: 'transition', family: 'manual', approvedForAuto: true })
    expect(() => production.enqueue(1, 1, [{ ...effect, durationSeconds: 8 }])).toThrow('Duración')
    expect(() => production.enqueue(1, 1, [{ ...effect, effectType: 'transition', durationSeconds: 12.5 }])).toThrow('Duración')
    expect(() => production.enqueue(1, 1, [{ ...input, effectType: 'transition' }])).toThrow('Tipo de efecto')
    const beforeClassification = getResource(`generated-${transition.jobId}`)!
    const classified = editResource(1, beforeClassification.id, { metadata: { category: 'Expectativa', effectType: 'short' } })
    expect(classified.metadata).toMatchObject({ category: 'anticipation', effectType: 'short', generationInput: { effectType: 'transition', category: 'celebration' } })
    expect(classified.checksum).toBe(beforeClassification.checksum)
    await production.stop()
    db.run('UPDATE catalogGenerationJobs SET generationKey=\'legacy-category-key\',configJSON=json_set(configJSON,\'$.category\',\'Celebración\') WHERE jobId=?', [legacy.jobId])
    await loadCatalog(directory)
    production = new CatalogProduction(directory, options, published)
    await production.start()
    await production.check()
    expect(production.enqueue(1, 1, [effect])[0].jobId).toBe(legacy.jobId)
    expect(requests).toHaveLength(2)
  })

  it('replaces an overlong upload in place while retaining its metadata and using no provider', async () => {
    const failed = await production.upload(1, 'uploaded-applause', 'effect', 'Aplausos', { category: 'Celebración', family: 'celebration', modes: ['mixed'] }, wav(5), 'long.wav')
    expect(failed).toMatchObject({ preparation: 'failed', error: expect.stringContaining('máximo') })
    const replaced = await production.replaceUpload(1, failed.id, wav(4.1), 'short.wav')
    expect(replaced).toMatchObject({ id: failed.id, title: 'Aplausos', preparation: 'ready', error: null, metadata: { category: 'celebration', family: 'celebration', modes: ['mixed'], originalName: 'short.wav' } })
    expect(replaced.durationMs).toBeGreaterThanOrEqual(4100)
    expect(replaced.durationMs).toBeLessThanOrEqual(4500)
    await loadCatalog(directory)
    expect(getResource(failed.id)?.preparation).toBe('ready')
    expect(db.get<{ n: number }>('SELECT count(*) n FROM audioResources WHERE roomId=1')?.n).toBe(1)
    expect(requests).toHaveLength(0)
  })

  it('preserves valid media on rejection and keeps disabled state and usage after successful replacement', async () => {
    await production.upload(1, 'uploaded-existing', 'effect', 'Aplausos', {}, wav(), 'original.wav')
    db.run('UPDATE audioResources SET state=\'disabled\' WHERE id=\'uploaded-existing\'')
    db.run('INSERT INTO audioUsage(roomId,sourceId,clipId,sourceType,businessDate,startedAt) VALUES(1,\'heard\',\'uploaded-existing\',\'intervention\',\'2026-10-29\',1)')
    const before = getResource('uploaded-existing')!
    const bytes = await fs.readFile(path.join(directory, before.filename!))
    await expect(production.replaceUpload(1, before.id, wav(4.6), 'too-long.wav')).rejects.toThrow('máximo')
    expect(getResource(before.id)).toEqual(before)
    expect(await fs.readFile(path.join(directory, before.filename!))).toEqual(bytes)
    const result = await production.replaceUpload(1, before.id, wav(2), 'valid.wav')
    expect(result).toMatchObject({ preparation: 'ready', state: 'disabled' })
    expect(result.checksum).not.toBe(before.checksum)
    expect(db.get<{ n: number }>('SELECT count(*) n FROM audioUsage WHERE clipId=?', [before.id])?.n).toBe(1)
    await expect(fs.access(path.join(directory, before.filename!))).rejects.toThrow()
    await loadCatalog(directory)
    expect(getResource(before.id)?.checksum).toBe(result.checksum)
  })

  it('rejects foreign, included and generated replacements', async () => {
    await production.upload(1, 'uploaded-private', 'effect', 'Private', {}, wav(), 'valid.wav')
    await expect(production.replaceUpload(2, 'uploaded-private', wav(), 'valid.wav')).rejects.toThrow('subidos a esta sala')
    await expect(production.replaceUpload(1, 'demo-welcome', wav(), 'valid.wav')).rejects.toThrow('subidos a esta sala')
    const [job] = production.enqueue(1, 1, [input])
    await production.drain()
    await expect(production.replaceUpload(1, `generated-${job.jobId}`, wav(), 'valid.wav')).rejects.toThrow('subidos a esta sala')
    expect(requests).toHaveLength(1)
  })

  it('rejects concurrent replacements and never resurrects a deleted upload', async () => {
    await production.upload(1, 'uploaded-changing', 'effect', 'Changing', {}, wav(), 'valid.wav')
    const replacing = production.replaceUpload(1, 'uploaded-changing', wav(2), 'new.wav')
    await expect(production.replaceUpload(1, 'uploaded-changing', wav(), 'other.wav')).rejects.toThrow('preparación')
    deleteResource(1, 'uploaded-changing')
    await expect(replacing).rejects.toThrow('ya no está disponible')
    expect(getResource('uploaded-changing')).toBeUndefined()
    expect(await fs.readdir(path.join(directory, 'production'))).toEqual([])
  })

  it('rechecks playback at publication so a newly pending announcement keeps its original audio', async () => {
    await production.upload(1, 'uploaded-in-use', 'effect', 'In use', {}, wav(), 'valid.wav')
    const original = getResource('uploaded-in-use')!
    const replacing = production.replaceUpload(1, original.id, wav(2), 'new.wav')
    db.run(`INSERT INTO animationInterventions(interventionId,roomId,requestId,requestedByUserId,clipId,clipChecksum,displayText,durationMs,status,requestedAt,expiresAt)
      VALUES('pending',1,'pending',1,?,?,'Aplauso',1000,'PENDING',0,?)`, [original.id, original.checksum, Date.now() + 10000])
    await expect(replacing).rejects.toThrow('en uso')
    await expect(production.replaceUpload(1, original.id, wav(), 'new.wav')).rejects.toThrow('en uso')
    expect(getResource(original.id)).toEqual(original)
    expect(await fs.readdir(path.join(directory, 'production'))).toEqual([path.basename(original.filename!)])
  })

  it('keeps deleted generation history without resurrecting audio or charging until a new explicit request', async () => {
    const [job] = production.enqueue(1, 1, [input])
    await production.drain()
    const units = production.status().usedCharacters
    deleteResource(1, `generated-${job.jobId}`)
    await expect(production.register(1, job.jobId)).rejects.toThrow('eliminado')
    await production.stop()
    await loadCatalog(directory)
    production = new CatalogProduction(directory, options, published)
    await production.start()
    expect(getResource(`generated-${job.jobId}`)).toBeUndefined()
    expect(production.status().usedCharacters).toBe(units)
    expect(requests).toHaveLength(1)
    await production.check()
    const [replacement] = production.enqueue(1, 1, [input])
    await production.drain()
    expect(replacement.jobId).not.toBe(job.jobId)
    expect(getResource(`generated-${replacement.jobId}`)?.preparation).toBe('ready')
    expect(requests).toHaveLength(2)
    expect(production.status().usedCharacters).toBe(units * 2)
  })

  it('restores verified voices without requiring a default voice environment variable', async () => {
    options.voiceId = ''
    const status = production.status()
    expect(status.connectionVerified).toBe(true)
    expect(status.voices).toEqual([{ voiceId: 'testvoice', name: 'Test voice' }])
    expect(status.voiceId).toBe('testvoice')
    const accepted = production.enqueue(1, 1, [{ ...input, voiceId: status.voiceId }])
    expect(accepted).toHaveLength(1)
    await production.drain()
    expect(production.list(1)[0].status).toBe('published')
  })

  it('deduplicates generation and makes valid output automatically available without exposing secrets', async () => {
    production.enqueue(1, 1, [input, input])
    production.enqueue(1, 1, [input])
    await production.drain()
    const [job] = production.list(1)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toContain('/text-to-speech/testvoice')
    expect(requests[0].body).toMatchObject({ model_id: 'eleven_v4', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    expect(requests[0].body).not.toHaveProperty('speed')
    expect(job.status).toBe('published')
    expect(catalogAsset(`generated-${job.jobId}`)).toBeDefined()
    expect(published).toHaveBeenCalledOnce()
    expect(JSON.stringify(production.status()) + JSON.stringify(job)).not.toContain('test-secret')
    await expect(production.audio(2, job.jobId)).rejects.toThrow('disponible')
    await production.register(1, job.jobId)
    await production.register(1, job.jobId)
    expect(catalogAsset(`generated-${job.jobId}`)?.clip).toMatchObject({ roomId: 1, family: 'welcome', approvedForAuto: true })
    expect(catalogClips(2).some(clip => clip.id === `generated-${job.jobId}`)).toBe(false)
    expect(requests).toHaveLength(1)
  })

  it('uses Sound Effects for effects and looping ambience, not the speech model', async () => {
    production.enqueue(1, 1, [
      { ...input, kind: 'effect', text: 'A short gentle applause.', durationSeconds: 4.5 },
      { ...input, kind: 'ambience', text: 'Quiet room ambience.', durationSeconds: 8 },
    ])
    await production.drain()
    expect(requests).toHaveLength(2)
    expect(requests.every(request => request.url.startsWith('/v1/sound-generation'))).toBe(true)
    expect(requests[0].body).toMatchObject({ model_id: 'eleven_text_to_sound_v2', loop: false, duration_seconds: 4.5 })
    expect(requests[1].body).toMatchObject({ loop: true, duration_seconds: 8 })
    expect(production.status().usedEffectSeconds).toBe(12.5)
  })

  it('changes cache keys for explicit audio tags and deliberate regenerations', async () => {
    production.enqueue(1, 1, [input, { ...input, text: `[excited] ${input.text}` }, { ...input, revision: 1 }])
    await production.drain()
    expect(requests).toHaveLength(3)
    expect(production.list(1)).toHaveLength(3)
  })

  it('preserves free-form voice tags without injecting a style or displaying tags to the public', async () => {
    const text = '[excited] ¡Bienvenidos!\n[con voz cálida] Disfruten la noche. [laughs]'
    const [job] = production.enqueue(1, 1, [{ ...input, text }])
    await production.drain()
    expect(requests[0].body.text).toBe(text)
    expect(requests[0].body.language_code).toBe('es')
    expect(job.config.style).toBeUndefined()
    expect(catalogAsset(`generated-${job.jobId}`)?.clip.displayText).toBe('¡Bienvenidos! Disfruten la noche.')
    expect(() => production.enqueue(1, 1, [{ ...input, text: '[excited Hola' }])).toThrow('corchetes')
    expect(() => production.enqueue(1, 1, [{ ...input, text: '<break time="1s" /> Hola' }])).toThrow('HTML ni SSML')
  })

  it('rolls back an entire batch when the configured budget is exceeded', () => {
    options.characterLimit = input.text.length + 1
    expect(() => production.enqueue(1, 1, [input, { ...input, text: 'Otra frase diferente.' }])).toThrow('límite mensual')
    expect(production.list(1)).toHaveLength(0)
    expect(requests).toHaveLength(0)
  })

  it.each(['corrupt', 'silent', 'long', 'reject'] as const)('rejects %s output without publishing', async (failure) => {
    mode = failure
    production.enqueue(1, 1, [input])
    await production.drain()
    const [job] = production.list(1)
    expect(job.status).toBe('failed')
    expect(catalogAsset(`generated-${job.jobId}`)).toBeUndefined()
    await expect(production.register(1, job.jobId)).rejects.toThrow('preparado')
  })

  it('retains uncertain provider outcomes and does not retry them implicitly', async () => {
    mode = 'error'
    production.enqueue(1, 1, [input])
    await production.drain()
    expect(production.list(1)[0].status).toBe('uncertain')
    production.enqueue(1, 1, [input])
    await production.drain()
    expect(requests).toHaveLength(1)
    expect(production.status().usedCharacters).toBeGreaterThan(0)
  })

  it('returns the requested cached failure, not a newer unrelated job', async () => {
    mode = 'error'
    const [failed] = production.enqueue(1, 1, [input])
    await production.drain()
    mode = 'ok'
    production.enqueue(1, 1, [{ ...input, text: 'Otro mensaje para la sala.' }])
    await production.drain()
    const accepted = production.enqueue(1, 1, [input])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({ jobId: failed.jobId, status: 'uncertain' })
    expect(requests).toHaveLength(2)
  })

  it('keeps requested older jobs visible and preserves room isolation', async () => {
    const [first] = production.enqueue(1, 1, [input])
    await production.drain()
    await production.stop()
    for (let index = 0; index < 101; index++) production.enqueue(1, 1, [{ ...input, text: `Otro mensaje número ${index}.` }])
    expect(production.list(1).some(job => job.jobId === first.jobId)).toBe(false)
    expect(production.list(1, [first.jobId]).find(job => job.jobId === first.jobId)?.status).toBe('published')
    expect(production.list(2, [first.jobId])).toHaveLength(0)
    expect(production.enqueue(1, 1, [input])[0].jobId).toBe(first.jobId)
    expect(requests).toHaveLength(1)
  })

  it('reports a safe provider rejection code without echoing provider messages', async () => {
    mode = 'bad-setting'
    production.enqueue(1, 1, [input])
    await production.drain()
    expect(production.list(1)[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('invalid_stability') })
    expect(production.list(1)[0].error).not.toContain('test-secret')
  })

  it('recovers a restarted generating job as uncertain without another paid request', async () => {
    await production.stop()
    production.enqueue(1, 1, [input])
    db.run('UPDATE catalogGenerationJobs SET status=\'generating\',startedAt=?', [Date.now()])
    production = new CatalogProduction(directory, options)
    await production.start()
    expect(production.list(1)[0].status).toBe('uncertain')
    expect(requests).toHaveLength(0)
  })
  it('cancels work not yet sent and releases its reserved production allowance', async () => {
    await production.stop()
    production.enqueue(1, 1, [input])
    const [job] = production.list(1)
    expect(production.status().usedCharacters).toBeGreaterThan(0)
    expect(() => production.cancel(2, job.jobId)).toThrow('ya se envió')
    production.cancel(1, job.jobId)
    expect(production.list(1)[0].status).toBe('cancelled')
    expect(production.status().usedCharacters).toBe(0)
    expect(requests).toHaveLength(0)
  })

  it('uploads without a provider, keeps metadata and does not synthesize', async () => {
    await production.stop()
    production = new CatalogProduction(directory, { ...options, key: '' }, published)
    await production.start()
    const result = await production.upload(1, 'uploaded-test', 'effect', 'Aplauso', { category: 'Celebración', family: 'celebration' }, wav(), 'aplauso.wav')
    expect(result).toMatchObject({ preparation: 'ready', state: 'active', kind: 'effect', metadata: { origin: 'uploaded', category: 'celebration' } })
    expect(catalogClips(1).some(clip => clip.id === result.id)).toBe(true)
    expect(getResource(result.id, 2)).toBeUndefined()
    expect(requests).toHaveLength(0)
  })

  it('supports an effect-only provider without fetching voices or using an ElevenLabs model', async () => {
    await production.stop()
    const alternative: AudioProvider = { capabilities: { id: 'fixture', name: 'Fixture', configured: true, kinds: ['effect'], models: { effect: 'fixture-effects' }, styles: [], languages: [], loop: false },
      check: vi.fn(async () => []), generate: vi.fn(async () => ({ bytes: wav(), requestId: 'fake-1' })) }
    production = new CatalogProduction(directory, { ...options, key: '' }, published, [alternative])
    await production.start()
    await production.check('fixture', 'effect')
    const [job] = production.enqueue(1, 1, [{ ...input, providerId: 'fixture', kind: 'effect', durationSeconds: 1 }])
    await production.drain()
    expect(resourceDTO(getResource(`generated-${job.jobId}`)!)).toMatchObject({ preparation: 'ready', metadata: { providerId: 'fixture', model: 'fixture-effects' } })
    expect(alternative.generate).toHaveBeenCalledOnce()
  })

  it('retries a failed local registration from its stored file without regenerating', async () => {
    const registration = vi.spyOn(catalog, 'saveCatalogRecord').mockRejectedValueOnce(new Error('Temporary storage error'))
    const [job] = production.enqueue(1, 1, [input])
    await production.drain()
    expect(getResource(`generated-${job.jobId}`)?.preparation).toBe('failed')
    expect(requests).toHaveLength(1)
    registration.mockRestore()
    await production.register(1, job.jobId)
    expect(getResource(`generated-${job.jobId}`)?.preparation).toBe('ready')
    expect(requests).toHaveLength(1)
  })

  it.each(['mp3', 'ogg'])('prepares a real %s upload by content', async (format) => {
    const bytes = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-f', format, 'pipe:1'])
    const result = await production.upload(1, `uploaded-${format}`, 'voice', format, {}, bytes, `fixture.${format}`)
    expect(result.preparation).toBe('ready')
    expect(result.durationMs).toBeGreaterThan(900)
  })

  it('rejects unsupported content renamed as WAV', async () => {
    const bytes = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1', '-f', 'flac', 'pipe:1'])
    const result = await production.upload(1, 'uploaded-disguised', 'voice', 'Wrong format', {}, bytes, 'fixture.wav')
    expect(result.preparation).toBe('failed')
    expect(result.error).toContain('MP3, WAV u OGG')
  })

  it('distinguishes deliberate versions of the same original while deduplicating a retried version request', async () => {
    const [original] = production.enqueue(1, 1, [input])
    await production.drain()
    const version = { ...input, parentId: `generated-${original.jobId}`, revision: 1, versionRequestId: 'intent-one' }
    const [first] = production.enqueue(1, 1, [version])
    const [retry] = production.enqueue(1, 1, [version])
    const [second] = production.enqueue(1, 1, [{ ...version, versionRequestId: 'intent-two' }])
    await production.drain()
    expect(first.jobId).toBe(retry.jobId)
    expect(second.jobId).not.toBe(first.jobId)
    expect(requests).toHaveLength(3)
    expect(getResource(`generated-${original.jobId}`)?.preparation).toBe('ready')
  })

  it('reconciles old generation keys so omitted provider defaults do not regenerate an existing audio', async () => {
    const [job] = production.enqueue(1, 1, [input])
    await production.drain()
    await production.stop()
    const legacy = { ...job.config }
    delete legacy.providerId
    delete legacy.language
    db.run('UPDATE catalogGenerationJobs SET generationKey=?,configJSON=? WHERE jobId=?', ['old-key', JSON.stringify(legacy), job.jobId])
    production = new CatalogProduction(directory, options, published)
    await production.start()
    await production.check()
    const [reused] = production.enqueue(1, 1, [{ ...input, category: '', language: 'es', providerId: 'elevenlabs' }])
    await production.drain()
    expect(reused.jobId).toBe(job.jobId)
    expect(requests).toHaveLength(1)
  })
})
