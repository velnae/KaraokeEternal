import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { BirthdayService } from './Service.js'
import { createBirthday, changeBirthday, eventDTO, getBirthday, publicEvents, saveSettings, settings } from './Store.js'
import { birthdayIntroText } from '../../shared/birthdays.js'
import { changeScene } from './scenes.js'
import { speechProfile } from './personalization.js'
import { birthdayPreviewName, birthdayPreviewScript } from '../../shared/birthdayPreview.js'
import Animation, { type Reservation } from '../Animation/Animation.js'

function wave (seconds = 12) {
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
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 24000) * 5000), 44 + i * 2)
  return buffer
}
let directory: string
let service: BirthdayService
const script = 'María… hoy la música nos reúne para celebrar contigo. Que esta noche esté llena de sonrisas y momentos memorables. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, María!'
const write = vi.fn(async () => script)
const speak = vi.fn(async () => wave())
const input = { name: 'María', sex: 'female', birthYear: 2000 }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'birthday-test-'))
  open({ file: path.join(directory, 'db.sqlite'), ro: false })
  db.run('INSERT INTO rooms(roomId,name,status,data) VALUES(1,\'Room\',\'open\',\'{}\'),(2,\'Other\',\'open\',\'{}\')')
  for (const kind of ['intro', 'music', 'video']) {
    await fs.writeFile(path.join(directory, kind), 'fixture')
    db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(?,1,?,?,?,1000,?)', [kind, kind, kind, kind, 'checksum'])
  }
  saveSettings(1, { revision: 0, textModel: 'test-model', defaultVoiceId: 'voice', rules: [], introId: 'intro', musicId: 'music', videoId: 'video' })
  write.mockReset().mockResolvedValue(script)
  speak.mockReset().mockImplementation(async () => wave())
  service = new BirthdayService(directory, undefined, { write, speak })
  await service.start()
  await service.drain()
})
afterEach(async () => {
  await service.stop()
  close()
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})
const create = (requestId = 'birthday-test') => createBirthday(1, requestId, input)
const prepared = async () => {
  const row = create()
  await service.drain()
  return getBirthday(1, row.id)
}

it('synthesizes a preview of at most45 words without creating an event or changing settings', async () => {
  const config = settings(1)
  const text = birthdayPreviewScript(birthdayPreviewName)
  expect(text.split(/\s+/).length).toBeLessThanOrEqual(45)
  const resource = await service.audition(1, speechProfile(config), { name: birthdayPreviewName, script: text }, config)
  expect(resource.script).toBe(text)
  expect(resource.kind).toBe('greeting')
  expect(speak).toHaveBeenCalledWith(text, config.defaultVoiceId, expect.any(AbortSignal), speechProfile(config))
  expect(write).not.toHaveBeenCalled()
  expect(db.all('SELECT * FROM birthdays')).toEqual([])
  expect(db.all('SELECT * FROM birthdayIntroUses')).toEqual([])
  expect(settings(1)).toEqual(config)
})

it('regenerates only an explicitly requested preview and voices the returned script', async () => {
  const config = settings(1)
  const resource = await service.audition(1, speechProfile(config), { name: 'María', regenerate: true }, config)
  expect(resource.script).toBe(script)
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ name: 'María', personalizationJSON: expect.any(String) }), expect.objectContaining({ targetSeconds: 22.5 }), expect.any(AbortSignal))
  expect(speak).toHaveBeenCalledWith(script, config.defaultVoiceId, expect.any(AbortSignal), speechProfile(config))
  expect(db.all('SELECT * FROM birthdays')).toEqual([])
})

it('rejects invalid samples before synthesis and rejects invalid generated scripts', async () => {
  const config = settings(1)
  const profile = speechProfile(config)
  await expect(service.audition(1, profile, { name: '', script })).rejects.toThrow()
  await expect(service.audition(1, profile, { name: 'Carlos', script })).rejects.toThrow()
  await expect(service.audition(1, profile, { name: 'María', regenerate: 'true' })).rejects.toThrow()
  expect(write).not.toHaveBeenCalled()
  expect(speak).not.toHaveBeenCalled()
  write.mockResolvedValueOnce('Un saludo sin el nombre solicitado.')
  await expect(service.audition(1, profile, { name: 'María', regenerate: true })).rejects.toThrow()
  expect(speak).not.toHaveBeenCalled()
})

it.each([
  `María… ${'Cariño '.repeat(34)}La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, María!`,
  'María… te deseamos alegría. La pizzería Il Gatto se suma con alegría. ¡Feliz cumpleaños!',
  'María… te deseamos alegría. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, María! Un abrazo.',
  'María, te deseamos alegría. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, María!',
])('rejects a nonconforming generated greeting before spending a speech call', async (text) => {
  write.mockResolvedValueOnce(text)
  const row = await prepared()
  expect(row.preparation).toBe('failed')
  expect(row.script).toBeNull()
  expect(speak).not.toHaveBeenCalled()
})

it('integrates a dedication before the ending without appending it again or selecting history', async () => {
  const dedication = 'Con cariño, de tus amigos de la mesa 05'
  const text = `María… hoy celebramos contigo. ${dedication}. La pizzería Il Gatto se suma con alegría. ¡feliz cumpleaños, María!`
  write.mockResolvedValueOnce(text)
  const row = createBirthday(1, 'with-dedication', { ...input, birthYear: 1969, dedication })
  await service.drain()
  const ready = getBirthday(1, row.id)
  expect(ready.script).toBe(text)
  expect(eventDTO(ready).personalization?.reference).toBeNull()
  expect(eventDTO(ready).personalization?.speech).toEqual(speechProfile(settings(1)))
  expect(speak).toHaveBeenCalledWith(text, settings(1).defaultVoiceId, expect.any(AbortSignal), speechProfile(settings(1)))
})

it('rejects impossible full-name budgets before asking either provider to generate', async () => {
  const row = createBirthday(1, 'impossible-name-budget', { ...input, name: Array(21).fill('A').join(' ') })
  await service.drain()
  expect(getBirthday(1, row.id).error).toContain('nombre completo')
  expect(write).not.toHaveBeenCalled()
  expect(speak).not.toHaveBeenCalled()
})

it('keeps old prepared audio but requires the new text contract before explicitly revoicing it', async () => {
  const row = await prepared()
  const old = eventDTO(row).assets.find(asset => asset.kind === 'greeting')!
  const context = { ...eventDTO(row).personalization!, version: 1 }
  db.run('UPDATE birthdays SET script=?,personalizationJSON=? WHERE id=?', ['María, celebramos contigo esta noche. ¡Feliz cumpleaños!', JSON.stringify(context), row.id])
  speak.mockClear()
  const updated = changeBirthday(1, row.id, row.revision, 'revoice')
  await service.drain()
  expect(getBirthday(1, updated.id).preparation).toBe('failed')
  expect(speak).not.toHaveBeenCalled()
  expect(db.get('SELECT id FROM birthdayAssets WHERE id=?', [old.id])).toEqual({ id: old.id })
})

it('preserves the existing voice-only audition contract', async () => {
  const resource = await service.audition(1, speechProfile(settings(1)))
  expect(resource.script).toContain('¡feliz cumpleaños, Carlos!')
  expect(write).not.toHaveBeenCalled()
  expect(speak).toHaveBeenCalledOnce()
})
it('persists a held event with no public exposure and deduplicates creation', () => {
  const row = create()
  expect(create().id).toBe(row.id)
  expect(row.playback).toBe('held')
  expect(publicEvents(1)).toEqual([])
  expect(() => getBirthday(2, row.id)).toThrow('sala')
  expect(() => createBirthday(1, 'birthday-test', { ...input, name: 'Otro' })).toThrow('otros datos')
})

it('adds an optional bed without regenerating speech or extending the event and keeps its snapshot on revoice', async () => {
  await fs.writeFile(path.join(directory, 'bed'), 'fixture')
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'bed\',1,\'bed\',\'Bed\',\'bed\',10000,\'bed-checksum\')')
  saveSettings(1, { ...settings(1), bedId: 'bed', bedVolume: 0.3 })
  const row = await prepared()
  const greetingDuration = eventDTO(row).assets.find(asset => asset.kind === 'greeting')!.durationMs
  expect(row.durationMs).toBe(greetingDuration + 2000 + 4500)
  expect(eventDTO(row).bedVolume).toBe(0.3)
  saveSettings(1, { ...settings(1), bedId: null, bedVolume: 0.8 })
  const revoiced = changeBirthday(1, row.id, row.revision, 'revoice')
  expect(JSON.parse(revoiced.settingsJSON)).toMatchObject({ bedId: 'bed', bedVolume: 0.3 })
  await service.drain()
  const ready = getBirthday(1, row.id)
  changeBirthday(1, row.id, ready.revision, 'schedule')
  const grant = await service.reserve(1, 'player')
  expect(grant).toMatchObject({ bedVolume: 0.3 })
  if (!grant || !('assets' in grant)) throw new Error('Missing grant')
  expect(grant.assets.filter(asset => asset.kind === 'bed')).toHaveLength(1)
  expect(write).toHaveBeenCalledOnce()
})

it('continues preparation and playback when only the configured bed file is missing', async () => {
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'missing-bed\',1,\'bed\',\'Bed\',\'missing-bed\',10000,\'bed-checksum\')')
  saveSettings(1, { ...settings(1), bedId: 'missing-bed' })
  const row = await prepared()
  expect(row.preparation).toBe('ready')
  changeBirthday(1, row.id, row.revision, 'schedule')
  const grant = await service.reserve(1, 'player')
  expect(grant).toMatchObject({ warning: expect.stringContaining('sin acompañamiento') })
  if (!grant || !('assets' in grant)) throw new Error('Missing grant')
  expect(grant.assets.filter(asset => asset.kind === 'bed')).toEqual([])
  expect(getBirthday(1, row.id).playback).toBe('playing')
})

it('reports stale settings as an HTTP conflict without overwriting the newer configuration', () => {
  const original = settings(1)
  const updated = saveSettings(1, { ...original, targetSeconds: 30 })
  expect(() => saveSettings(1, original)).toThrow(expect.objectContaining({ status: 409 }))
  expect(settings(1)).toEqual(updated)
})
it('accepts approval during generation without cancelling preparation or duplicating the slot', async () => {
  let complete!: (text: string) => void
  write.mockImplementationOnce(() => new Promise((resolve) => {
    complete = resolve
  }))
  const first = create()
  const work = service.drain()
  const scheduled = changeBirthday(1, first.id, 0, 'schedule')
  expect(changeBirthday(1, first.id, 0, 'schedule').revision).toBe(scheduled.revision)
  const second = create('birthday-second')
  expect(() => changeBirthday(1, second.id, 0, 'schedule')).toThrow('Ya hay')
  complete(script)
  await work
  expect(getBirthday(1, first.id).preparation).toBe('ready')
  expect(getBirthday(1, first.id).playback).toBe('scheduled')
  expect(publicEvents(1)[0]).not.toHaveProperty('birthYear')
  expect(publicEvents(1)[0]).not.toHaveProperty('sex')
})
it('keeps scene adjustments made while text is being generated without restarting providers', async () => {
  let complete!: (text: string) => void
  write.mockImplementationOnce(() => new Promise((resolve) => {
    complete = resolve
  }))
  await fs.writeFile(path.join(directory, 'alternate'), 'fixture')
  db.run('INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES(\'alternate\',1,\'intro\',\'Alternative\',\'alternate\',2500,\'alternate\')')
  const row = create()
  const work = service.drain()
  changeScene(getBirthday(1, row.id), { revision: row.revision, introId: 'alternate' })
  complete(script)
  await work
  const ready = getBirthday(1, row.id)
  expect(ready.preparation).toBe('ready')
  expect(ready.generationRevision).toBe(row.generationRevision)
  expect(eventDTO(ready).assets.find(asset => asset.kind === 'intro')!.id).toBe('alternate')
  expect(ready.durationMs).toBe(3500 + 4500 + eventDTO(ready).assets.find(asset => asset.kind === 'greeting')!.durationMs)
  expect(write).toHaveBeenCalledOnce()
  expect(speak).toHaveBeenCalledOnce()
})
it('stores custom introduction scripts and rejects incomplete variants before speech generation', async () => {
  const text = '¡Feliz cumpleaños! Hoy la casa celebra contigo y tiene un presente para ti. Recibe este saludo con mucho cariño.'
  const resource = await service.intro(1, 'voice', text, 'Celebración cálida')
  expect(resource.script).toBe(text)
  expect(resource.title).toBe('Celebración cálida')
  expect(speak).toHaveBeenCalledOnce()
  await expect(service.intro(1, 'voice', 'La casa tiene un presente especial para ti.')).rejects.toThrow('cumpleaños')
  await expect(service.intro(1, 'voice', '¡Feliz cumpleaños! Que disfrutes mucho esta noche.')).rejects.toThrow('presente')
  expect(speak).toHaveBeenCalledOnce()
})
it('prepares real audio longer than ten seconds without registering it in the animator catalog', async () => {
  const row = await prepared()
  expect(row.preparation).toBe('ready')
  expect(eventDTO(row).assets.find(item => item.kind === 'greeting')!.durationMs).toBeGreaterThan(10000)
  expect(db.get('SELECT count(*) n FROM audioResources')).toEqual({ n: 0 })
  expect(write).toHaveBeenCalledOnce()
  expect(speak).toHaveBeenCalledOnce()
})
it('rejects private details before synthesizing and keeps the event recoverable', async () => {
  write.mockResolvedValueOnce('María, cumples veintiséis años.')
  const row = await prepared()
  expect(row.preparation).toBe('failed')
  expect(row.error).toContain('privacidad')
  expect(speak).not.toHaveBeenCalled()
})
it('retains the script on synthesis failure and retries only speech', async () => {
  speak.mockRejectedValueOnce(new Error('Voice unavailable'))
  const row = await prepared()
  expect(row.script).toBe(script)
  changeBirthday(1, row.id, row.revision, 'retry')
  await service.drain()
  expect(write).toHaveBeenCalledOnce()
  expect(speak).toHaveBeenCalledTimes(2)
  expect(getBirthday(1, row.id).preparation).toBe('ready')
})
it('edits invalidate the old script/audio while preserving the celebration year', async () => {
  const row = await prepared()
  const next = changeBirthday(1, row.id, row.revision, 'edit', { name: 'José', sex: 'male', birthYear: 1990 })
  expect(next.script).toBeNull()
  expect(next.greetingId).toBeNull()
  expect(next.celebrationYear).toBe(row.celebrationYear)
  expect(next.generationRevision).toBe(1)
})
it('requires complete resources, preserves snapshot choices, and supports withdrawing approval', async () => {
  const row = await prepared()
  saveSettings(1, { ...settings(1), musicId: null })
  expect(eventDTO(getBirthday(1, row.id)).assets.some(item => item.id === 'music')).toBe(true)
  const scheduled = changeBirthday(1, row.id, row.revision, 'schedule')
  expect(changeBirthday(1, row.id, scheduled.revision, 'unschedule').playback).toBe('held')
  expect(() => create('missing-media')).toThrow('Seleccione la música')
})
it('grants exclusive playback, enforces the full phase order and settles only once', async () => {
  await fs.writeFile(path.join(directory, 'applause'), 'fixture')
  db.run(`INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES('applause',1,'applause','Aplauso','applause',3000,'checksum')`)
  saveSettings(1, { ...settings(1), applauseId: 'applause' })
  const row = await prepared()
  expect(JSON.parse(row.settingsJSON).applauseId).toBe('applause')
  expect(row.durationMs).toBe(eventDTO(row).assets.find(asset => asset.kind === 'greeting')!.durationMs + 2000 + 4500 + 3000)
  changeBirthday(1, row.id, row.revision, 'schedule')
  const grant = await service.reserve(1, 'player')
  if (!grant || !('token' in grant)) throw new Error('Missing grant')
  expect(grant.event.phase).toBe('prelude')
  expect(() => service.progress(1, 'player', row.id, grant.token, 'phase', 'intro')).toThrow('todavía no terminó')
  const identity = { roomId: 1, userId: 1, socketId: 'player' }
  expect(Animation.reserveGreeting(identity, 7, [], 1000, 1000, 'Otro anuncio')).toBeNull()
  expect(Animation.reserveAmbience(identity, 1, { isAtQueueEnd: true })).toBeNull()
  expect(Animation.reserveTransitionAmbience(identity, 1, {}, { sourceQueueId: null, expectedNextQueueId: null })).toBeNull()
  expect(() => Animation.reserve(identity, {} as Reservation, {})).toThrow('cumpleaños')
  await expect(service.reserve(1, 'second-player')).rejects.toThrow('Otro reproductor')
  expect(() => service.progress(1, 'player', row.id, grant.token, 'finish')).toThrow()
  for (const phase of ['intro', 'greeting', 'bridge', 'music', 'applause'] as const) {
    db.run('UPDATE birthdays SET phaseStartedAt=? WHERE id=?', [Date.now() - 60000, row.id])
    service.progress(1, 'player', row.id, grant.token, 'phase', phase)
  }
  expect(() => service.progress(1, 'player', row.id, grant.token, 'finish')).toThrow('todavía no terminó')
  db.run('UPDATE birthdays SET phaseStartedAt=? WHERE id=?', [Date.now() - 60000, row.id])
  service.progress(1, 'player', row.id, grant.token, 'finish')
  service.progress(1, 'player', row.id, grant.token, 'finish')
  expect(getBirthday(1, row.id).playback).toBe('completed')
  expect(publicEvents(1)).toEqual([])
})
it('finishes without blocking the queue when optional applause is unavailable', async () => {
  db.run(`INSERT INTO birthdayAssets(id,roomId,kind,title,filename,durationMs,checksum) VALUES('missing-applause',1,'applause','Missing applause','missing.mp3',3000,'checksum')`)
  saveSettings(1, { ...settings(1), applauseId: 'missing-applause' })
  const row = await prepared()
  changeBirthday(1, row.id, row.revision, 'schedule')
  const grant = await service.reserve(1, 'player')
  if (!grant || !('token' in grant)) throw new Error('Missing grant')
  expect(grant.warning).toContain('aplauso')
  expect(grant.assets.some(asset => asset.kind === 'applause')).toBe(false)
  expect(() => service.progress(1, 'player', row.id, grant.token, 'skipApplause')).toThrow()
  for (const phase of ['intro', 'greeting', 'bridge', 'music', 'applause'] as const) {
    db.run('UPDATE birthdays SET phaseStartedAt=? WHERE id=?', [Date.now() - 60000, row.id])
    service.progress(1, 'player', row.id, grant.token, 'phase', phase)
  }
  service.progress(1, 'player', row.id, grant.token, 'skipApplause')
  expect(getBirthday(1, row.id).playback).toBe('completed')
})
it('limits dedicated applause to ten seconds without borrowing animator resources', async () => {
  await expect(service.upload(1, 'applause', 'Too long', wave(11))).rejects.toThrow()
  const media = await service.upload(1, 'applause', 'Birthday applause', wave(3))
  expect(media.kind).toBe('applause')
  expect(media.durationMs).toBeLessThanOrEqual(3100)
})
it('reserves older snapshots on their original three-stage choreography', async () => {
  const row = await prepared()
  const snapshot = JSON.parse(row.settingsJSON)
  delete snapshot.choreographyVersion
  db.run('UPDATE birthdays SET settingsJSON=?,durationMs=durationMs-4500 WHERE id=?', [JSON.stringify(snapshot), row.id])
  changeBirthday(1, row.id, row.revision, 'schedule')
  const grant = await service.reserve(1, 'player')
  if (!grant || !('token' in grant)) throw new Error('Missing grant')
  expect(grant.choreographyVersion).toBeUndefined()
  expect(grant.event.phase).toBe('intro')
})
it('missing media releases the scheduled slot with a visible recoverable error', async () => {
  const row = await prepared()
  changeBirthday(1, row.id, row.revision, 'schedule')
  await fs.unlink(path.join(directory, 'music'))
  expect(await service.reserve(1, 'player')).toBeNull()
  expect(getBirthday(1, row.id)).toMatchObject({ playback: 'held', preparation: 'failed' })
})
it('recovers started events as interrupted on restart without replaying them', async () => {
  const row = await prepared()
  changeBirthday(1, row.id, row.revision, 'schedule')
  await service.reserve(1, 'player')
  await service.stop()
  service = new BirthdayService(directory, undefined, { write, speak })
  await service.start()
  expect(getBirthday(1, row.id).playback).toBe('interrupted')
  expect(await service.reserve(1, 'player')).toBeNull()
})
it('generates the fixed generic-present introduction and respects the voice duration limit', async () => {
  await service.intro(1, 'saved-voice')
  expect(speak).toHaveBeenCalledWith(birthdayIntroText, 'saved-voice', expect.any(AbortSignal), expect.objectContaining({ provider: 'elevenlabs', voice: 'saved-voice' }))
  await expect(service.upload(1, 'greeting', 'Too long', wave(61))).rejects.toThrow('máximo')
})

it('revoices without rewriting content and freezes retry speech identity across settings changes', async () => {
  const row = await prepared()
  const first = eventDTO(row).personalization!
  saveSettings(1, { ...settings(1), speechProvider: 'gemini', speechModel: 'gemini-3.8-flash-tts', defaultVoiceId: 'Sulafat', speechStyle: 'Cálida y alegre.' })
  const updated = changeBirthday(1, row.id, row.revision, 'revoice')
  expect(updated.script).toBe(row.script)
  expect(updated.greetingId).toBeNull()
  expect(eventDTO(updated).personalization!.speech).toMatchObject({ provider: 'gemini', voice: 'Sulafat' })
  await service.drain()
  expect(write).toHaveBeenCalledOnce()
  expect(speak).toHaveBeenCalledTimes(2)
  const ready = getBirthday(1, row.id)
  const lite = changeBirthday(1, row.id, ready.revision, 'lite')
  expect(eventDTO(lite).personalization!.speech.model).toBe('gemini-3.8-flash-lite-tts')
  expect(first.speech.provider).toBe('elevenlabs')
})

it('preserves legacy settings, ready assets and null context on an explicit retry', async () => {
  const row = await prepared()
  db.run('UPDATE birthdays SET personalizationJSON=NULL WHERE id=?', [row.id])
  const next = changeBirthday(1, row.id, row.revision, 'retry')
  expect(next.personalizationJSON).toBeNull()
  expect(next.greetingId).toBe(row.greetingId)
  expect(next.settingsJSON).toBe(row.settingsJSON)
  await service.drain()
  expect(write).toHaveBeenCalledOnce()
  expect(speak).toHaveBeenCalledOnce()
})

it('only changes audio when the interpretation changes, and retries keep their original profile', async () => {
  const row = await prepared()
  const original = row.script
  saveSettings(1, { ...settings(1), speechStyle: 'Suave y afectuosa.' })
  const changed = changeBirthday(1, row.id, row.revision, 'edit', input as Parameters<typeof changeBirthday>[4])
  expect(changed.script).toBe(original)
  expect(changed.greetingId).toBeNull()
  speak.mockRejectedValueOnce(new Error('Provider not confirmed'))
  await service.drain()
  const failed = getBirthday(1, row.id)
  const identity = eventDTO(failed).personalization!.speech
  saveSettings(1, { ...settings(1), speechStyle: 'Otra interpretación.' })
  const retry = changeBirthday(1, row.id, failed.revision, 'retry')
  expect(eventDTO(retry).personalization!.speech).toEqual(identity)
  await service.drain()
  expect(write).toHaveBeenCalledOnce()
})

it('never synthesizes a repeated opening or lets another person identity leak in public state', async () => {
  await prepared()
  const second = create('birthday-duplicate-opening')
  await service.drain()
  expect(getBirthday(1, second.id).preparation).toBe('failed')
  expect(getBirthday(1, second.id).error).toContain('repite')
  expect(speak).toHaveBeenCalledOnce()
})

it('upgrades legacy speech without attaching a new historical clause to its existing transcript', async () => {
  const row = createBirthday(1, 'legacy-history', { ...input, birthYear: 1969 })
  db.run('UPDATE birthdays SET personalizationJSON=NULL WHERE id=?', [row.id])
  await service.drain()
  const legacy = getBirthday(1, row.id)
  saveSettings(1, { ...settings(1), speechProvider: 'gemini', defaultVoiceId: 'Sulafat', speechModel: 'gemini-3.8-flash-tts', historyEvery: 1 })
  const revoice = changeBirthday(1, row.id, legacy.revision, 'revoice')
  expect(eventDTO(revoice).personalization!.reference).toBeNull()
  expect(revoice.script).toBe(legacy.script)
  await service.drain()
  expect(getBirthday(1, row.id).preparation).toBe('ready')
  expect(write).toHaveBeenCalledOnce()
})
