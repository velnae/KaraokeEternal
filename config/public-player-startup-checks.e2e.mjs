import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { installYouTubeTransitionFixture } from './transition-ambience-checks.e2e.mjs'

// The login tab has already closed. Transfer auth only: this document has never
// received a user gesture. Keep report data bounded; never save cookies or packets.
export async function checkColdStartup ({ browser, auth, base, data, source, emit, bed }) {
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
    if (source === 'local') await page.route(`**/api/animation/assets/${bed.id}`, route => route.fulfill({ status: 503, body: 'Unavailable fixture bed' }))
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
    if (source === 'local') {
      await expect.poll(() => page.evaluate(hash => window.karaokePlaybackTrace.snapshot().events.some(e => e.event === 'catalog-asset-failed' && e.checksum === hash), bed.checksum), { timeout: 15000 }).toBe(true)
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByLabel('Herramientas de desarrollo')).toHaveCount(0)
      const other = await context.newPage()
      let requests = 0
      other.on('websocket', ws => ws.on('framesent', ({ payload }) => {
        if (String(payload).includes('"server/PLAYER_REQ_PLAY"')) requests++
      }))
      await other.goto(`${base}player`)
      await expect(other.getByRole('heading', { name: 'Ya hay un reproductor activo' })).toBeVisible()
      await expect(other.getByRole('button', { name: 'Reproducir', exact: true })).toHaveCount(0)
      await other.keyboard.press('Enter')
      await other.close()
      assert.equal(requests, 0)
      await page.bringToFront()
    }
    await captureControls('beforePlay')
    assert.deepEqual(report.controls.beforePlay.sort(), ['Pantalla completa', 'Reproducir'])
    assert.equal(await page.evaluate(() => window.coldStartup.activatedAtLoad), false)
    if (source === 'youtube') {
      await page.keyboard.press('Control+Alt+k')
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('player-fs-container')
      await expect(play).toBeVisible()
      await page.getByRole('button', { name: 'Salir de pantalla completa' }).click()
      await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
      assert.ok(!report.events.some(e => e.event === 'play-request'))
    }
    mark('click-play')
    await play.press('Enter')
    await expect.poll(() => report.events.filter(e => e.event === 'play-command').length).toBe(1)
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.active?.status, { timeout: 20000 }).toBe('PLAYING')
    await captureControls('duringAnnouncement')
    assert.deepEqual(report.controls.duringAnnouncement, ['Pantalla completa'])
    const starts = () => page.evaluate(() => window.karaokePlaybackTrace.snapshot().events.filter(e => e.event === 'music-playing'))
    if (source === 'youtube') {
      await expect(play).toBeVisible({ timeout: 25000 })
      await captureControls('blocked')
      assert.equal((await starts()).length, 0)
      mark('provider-blocked')
      await play.click()
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
