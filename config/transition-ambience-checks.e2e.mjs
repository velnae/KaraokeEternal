import { expect } from 'playwright/test'
import assert from 'node:assert/strict'

export async function installYouTubeTransitionFixture (context, mediaPath) {
  await context.route('**/transition-youtube.mp4', route => route.fulfill({ path: mediaPath, contentType: 'video/mp4' }))
  await context.addInitScript(() => {
    window.youtubeTransition = { endedAt: 0, sceneAt: 0, video: null }
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (window.youtubeTransition.endedAt && !window.youtubeTransition.sceneAt && document.querySelector('[data-testid="transition-scene"]')) {
          window.youtubeTransition.sceneAt = performance.now()
        }
      }).observe(document.body, { childList: true, subtree: true })
    })
    window.YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
      Player: class {
        constructor (target, options) {
          this.options = options
          this.video = document.createElement('video')
          this.video.playbackRate = 0.85
          this.video.style.cssText = 'width:100%;height:100%'
          target.replaceChildren(this.video)
          window.youtubeTransition.video = this.video
          for (const [event, state] of [['playing', 1], ['pause', 2], ['ended', 0]]) {
            this.video.addEventListener(event, () => {
              if (state === 0) window.youtubeTransition.endedAt = performance.now()
              if (state !== 2 || !this.video.ended) options.events.onStateChange({ target: this, data: state })
            })
          }
          queueMicrotask(() => options.events.onReady({ target: this }))
        }

        loadVideoById () {
          this.video.src = `${document.baseURI}transition-youtube.mp4`
          this.playVideo()
        }

        cueVideoById () { this.video.src = `${document.baseURI}transition-youtube.mp4` }
        playVideo () { void this.video.play().catch(() => this.options.events.onAutoplayBlocked({ target: this })) }
        pauseVideo () { this.video.pause() }
        getCurrentTime () { return this.video.currentTime }
        seekTo (seconds) { this.video.currentTime = seconds }
        setVolume (volume) { this.video.volume = volume / 100 }
        setSize () {}
        destroy () {
          this.video.pause()
          this.video.removeAttribute('src')
          this.video.load()
        }
      },
    }
  })
}

export async function checkAmbienceHandoff ({ player, uiBase, emit, db, bed, voice, httpsUi }) {
  let snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true,
    ambienceEnabled: true, ambienceClipId: bed.id, ambienceVolume: 0.3,
    events: { welcome: false, turn: false, closing: false, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
  const queueId = Number(db.prepare(`INSERT INTO queue(roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin)
    VALUES(1,1,(SELECT max(queueId) FROM queue),'YOUTUBE','fixture0001','YouTube handoff','Fixture','OPERATOR')`).run().lastInsertRowid)
  await player.goto(`${uiBase}player`)
  await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(bed.checksum)).toBe(true)
  await emit('server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status).toBe('PLAYING')
  await expect.poll(() => player.evaluate(() => window.youtubeTransition.endedAt), { timeout: 10000 }).toBeGreaterThan(0)
  await expect.poll(() => player.evaluate(() => window.transitionTrace.starts.some(event => event.kind === 'ambience' && event.at >= window.youtubeTransition.endedAt))).toBe(true)
  const delay = await player.evaluate(() => window.transitionTrace.starts.find(event => event.kind === 'ambience' && event.at >= window.youtubeTransition.endedAt).at - window.youtubeTransition.endedAt)
  console.log(`YouTube end to ambience: ${Math.round(delay)} ms`)
  assert.ok(delay < (httpsUi ? 1800 : 500), `YouTube end to prepared ambience took ${Math.round(delay)} ms`)
  await expect(player.getByTestId('transition-scene')).toBeVisible()
  const sceneDelay = await player.evaluate(() => window.youtubeTransition.sceneAt - window.youtubeTransition.endedAt)
  assert.ok(sceneDelay >= 0 && Math.abs(delay - sceneDelay) < (httpsUi ? 1800 : 500), 'transition picture and prepared ambience start together')
  const level = () => player.evaluate(() => window.transitionTrace.levels().find(node => node.kind === 'ambience')?.volume)
  for (const volume of [0.7, 0.1]) {
    snapshot = (await emit('server/ANIMATION_SYNC')).payload
    await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, ambienceVolume: volume })
    await expect.poll(level).toBeCloseTo(volume, 2)
  }
  const operator = await player.context().newPage()
  try {
    await operator.goto(`${uiBase}admin/settings/animator?view=background`)
    const slider = operator.getByRole('region', { name: 'Sonido de pausa del reproductor' }).getByRole('slider', { name: 'Volumen de ambiente' })
    await expect(slider).toBeEnabled()
    await slider.press('End')
    await expect.poll(level).toBeCloseTo(1, 2)
    await expect(slider).toBeEnabled()
    await slider.press('ArrowLeft')
    await expect.poll(level).toBeCloseTo(0.95, 2)
  } finally { await operator.close() }
  // Voice must not duck the operator's configured ambience volume.
  snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, ambienceVolume: 0.4 })
  await emit('server/ANIMATION_REQUEST', { requestId: crypto.randomUUID(), clipId: voice.id })
  await expect.poll(() => player.evaluate(() => window.transitionTrace.active.includes('voice'))).toBe(true)
  await expect.poll(level).toBeCloseTo(0.4, 3)
  const before = await level()
  snapshot = (await emit('server/ANIMATION_SYNC')).payload
  await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, ambienceVolume: 0.8 })
  await expect.poll(level).toBeCloseTo(before * 2, 2)
  console.log(`PASS YouTube API fixture end → ambience ${Math.round(delay)} ms; live idle and voice-bed volume`)
}
