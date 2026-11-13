import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'playwright/test'

/** First-voice anticipation, not only anticipation of an already-running effect. */
export async function checkSceneTiming ({ player, uiBase, call, emit, db, data, voice, bed, background, effect }) {
  await emit('server/PLAYER_REQ_PAUSE')
  const settings = (await call('animation/scenes/')).settings
  const scene = settings.templates.find(scene => scene.id === 'transition')
  scene.startOffsetMs = 0
  scene.continueBed = false
  const announcement = scene.cues.find(cue => cue.id === 'announcement')
  Object.assign(announcement, { anchor: 'start', offsetMs: 1000, resourceId: voice.id })
  scene.cues.find(cue => cue.lane === 'background').resourceId = background.id
  scene.cues.find(cue => cue.lane === 'ambience').resourceId = bed.id
  const text = scene.cues.find(cue => cue.id === 'text')
  Object.assign(text, { anchor: 'block', referenceId: announcement.id, referenceEdge: 'start', offsetMs: -500, text: 'Texto antes de la voz', durationMs: 4000 })
  scene.cues.push({ ...announcement, id: 'timing-applause', binding: 'resource', resourceId: effect.id, anchor: 'block', referenceId: announcement.id, referenceEdge: 'end', offsetMs: 500 })
  settings.selected.transition = scene.id
  await call('animation/scenes/', settings, 'PUT')
  const snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true, ambienceEnabled: true, ambienceClipId: bed.id,
    events: { welcome: false, turn: true, closing: false, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
  await player.context().addInitScript(() => {
    window.sceneTiming = { backgrounds: [], texts: [], ends: [] }
    document.addEventListener('DOMContentLoaded', () => {
      let previousBackground = null
      let previousText = null
      new MutationObserver(() => {
        const background = document.querySelector('[data-background-cue="background"]')
        const text = document.querySelector('[data-scene-cue="text"]')
        if (background && background !== previousBackground) window.sceneTiming.backgrounds.push(performance.now())
        if (text && text !== previousText) window.sceneTiming.texts.push(performance.now())
        previousBackground = background
        previousText = text
      }).observe(document.body, { childList: true, subtree: true })
    })
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args)
      source.addEventListener('ended', () => window.sceneTiming.ends.push({ at: performance.now(), durationMs: source.buffer.duration * 1000 }))
      return source
    }
  })
  await player.goto(`${uiBase}player`)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(voice.checksum), { timeout: 20000 }).toBe(true)
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=2').get().status, { timeout: 30000 }).toBe('PLAYING')
  const observed = await player.evaluate(() => ({ ...window.sceneTiming, starts: window.transitionTrace.starts }))
  await fs.writeFile(path.join(data, 'first-voice-timing.json'), JSON.stringify(observed, null, 2))
  const voices = observed.starts.filter(event => event.kind === 'voice')
  assert.equal(voices.length, 2, 'one first voice at startup and one at the natural boundary')
  for (const voice of voices) {
    const background = observed.backgrounds.filter(at => at < voice.at).at(-1)
    const text = observed.texts.filter(at => at < voice.at).at(-1)
    assert.ok(background !== undefined && text !== undefined, 'background and text precede the first voice')
    const voiceAfterBackground = voice.at - background
    const textLead = voice.at - text
    assert.ok(voiceAfterBackground >= 800 && voiceAfterBackground <= 1200, `voice begins at +1s: ${voiceAfterBackground}ms`)
    assert.ok(textLead >= 350 && textLead <= 650, `text leads first voice by 500ms: ${textLead}ms`)
    const voiceEnd = observed.ends.find(event => event.at > voice.at && Math.abs(event.durationMs - 2000) < 20)
    const applause = observed.starts.find(event => event.kind === 'effect' && event.at > voice.at)
    assert.ok(voiceEnd && applause, 'complete voice followed by effect')
    assert.ok(applause.at - voiceEnd.at >= 450 && applause.at - voiceEnd.at <= 650, 'effect follows actual voice end by 500ms')
    console.log(`PASS first voice +${Math.round(voiceAfterBackground)}ms, text lead ${Math.round(textLead)}ms, effect gap ${Math.round(applause.at - voiceEnd.at)}ms`)
  }
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(() => player.evaluate(() => window.transitionTrace.active.length)).toBe(0)
  await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(false)
}
