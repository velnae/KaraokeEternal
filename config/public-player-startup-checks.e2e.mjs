import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'

// The login tab has already closed. Transfer auth only: this document has never
// received a user gesture. Keep report data bounded; never save cookies or packets.
export async function checkColdStartup ({ browser, auth, base, data, source, emit }) {
  const context = await browser.newContext({ storageState: auth })
  const report = { source, controls: {}, events: [] }
  const output = path.join(data, `cold-start-${source}.json`)
  try {
    await context.addInitScript(() => {
      window.coldStartup = { activatedAtLoad: navigator.userActivation.hasBeenActive, audio: [] }
      const resume = AudioContext.prototype.resume
      AudioContext.prototype.resume = function () {
        const event = { before: this.state, at: Date.now() }
        window.coldStartup.audio.push(event)
        const promise = resume.call(this)
        promise.then(() => { event.after = this.state }, () => { event.after = 'rejected' })
        return promise
      }
    })
    if (source === 'youtube') await installYouTubeTransitionFixture(context, path.join(data, 'song.mp4'), true)
    const page = await context.newPage()
    const mark = (event, fields = {}) => report.events.push({ event, at: Date.now(), ...fields })
    const captureControls = async phase => {
      report.controls[phase] = await page.locator('button:visible,a:visible').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || n.textContent.trim()).filter(Boolean))
    }
    page.on('websocket', ws => {
      for (const [direction, event] of [['framesent', 'play-request'], ['framereceived', 'play-command']]) {
        ws.on(direction, ({ payload }) => {
          const type = direction === 'framesent' ? 'server/PLAYER_REQ_PLAY' : 'player/CMD_PLAY'
          if (String(payload).includes(`"type":"${type}"`)) mark(event)
        })
      }
    })
    await page.goto(`${base}player`)
    const play = page.locator('#player-fs-container').getByRole('button', { name: 'Reproducir', exact: true })
    await expect(play).toBeVisible()
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(true)
    mark('player-present')
    await captureControls('beforePlay')
    assert.equal(report.controls.beforePlay.filter(name => name === 'Reproducir').length, 2, 'Baseline: both stage and toolbar expose Play')
    assert.ok(report.controls.beforePlay.includes('Animador'), 'Baseline: operator link visible in public player')
    assert.equal(await page.evaluate(() => window.coldStartup.activatedAtLoad), false)
    mark('click-play')
    await play.click()
    await expect.poll(() => report.events.filter(e => e.event === 'play-command').length).toBe(1)
    const stop = page.getByRole('button', { name: 'Detener anuncio', exact: true })
    await expect(stop).toBeVisible({ timeout: 20000 })
    await captureControls('duringAnnouncement')
    const starts = () => page.evaluate(() => window.karaokePlaybackTrace.snapshot().events.filter(e => e.event === 'music-playing'))
    if (source === 'youtube') {
      const retry = page.getByRole('button', { name: 'Reproducir aquí', exact: true })
      await expect(retry).toBeVisible({ timeout: 25000 })
      await captureControls('blocked')
      assert.equal((await starts()).length, 0)
      mark('provider-blocked')
      await retry.click()
    }
    await expect.poll(async () => (await starts()).length, { timeout: 25000 }).toBeGreaterThan(0)
    const first = (await starts())[0]
    mark('media-playing', { at: first.wallTime, queueId: first.queueId })
    assert.equal(first.queueId, 1)
    assert.equal(report.events.filter(e => e.event === 'play-request').length, 1)
    assert.ok(report.events.find(e => e.event === 'play-command').at <= first.wallTime)
    await captureControls('playing')
    report.activation = await page.evaluate(() => window.coldStartup)
    console.log(`PASS cold ${source} startup. Evidence: ${output}`)
  } finally {
    fs.writeFileSync(output, JSON.stringify(report, null, 2))
    await context.close()
  }
}
