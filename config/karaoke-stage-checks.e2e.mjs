import { expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function prepareKaraokeStage ({ api, base, call, data, page, uiBase, db }) {
  const original = (await call('rooms/1/karaoke-calls/backgrounds')).settings
  const source = path.join(data, 'stage-applause.wav')
  const entrySource = path.join(data, 'stage-entry.wav')
  const mascot = path.join(data, 'stage-mascot.gif')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100', '-t', '4.4', source])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '3.893', entrySource])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=2', '-t', '1', '-threads', '1', mascot])
  const response = await api.post(base + 'api/rooms/1/karaoke-calls/backgrounds/upload', { multipart: {
    kind: 'effect', requestId: crypto.randomUUID(), file: { name: 'Stage applause.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(source) },
  } })
  assert.equal(response.status(), 202, await response.text())
  const effect = await response.json()
  assert.equal(effect.state, 'ready')
  assert.ok(effect.durationMs > 4000 && effect.durationMs <= 4500)
  const entryResponse = await api.post(base + 'api/rooms/1/karaoke-calls/backgrounds/upload', { multipart: {
    kind: 'effect', requestId: crypto.randomUUID(), file: { name: 'Stage entry.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(entrySource) },
  } })
  assert.equal(entryResponse.status(), 202, await entryResponse.text())
  const entry = await entryResponse.json()
  assert.equal(entry.state, 'ready')
  await call(`rooms/1/karaoke-calls/backgrounds/assets/${entry.id}`, { active: true }, 'PATCH')
  const image = await api.post(base + 'api/player-logo-images/gif', { multipart: { file: { name: 'Mascot.gif', mimeType: 'image/gif', buffer: fs.readFileSync(mascot) } } })
  assert.equal(image.status(), 201, await image.text())
  const { id: mascotImageId } = await image.json()
  const overview = await call('rooms/1/karaoke-calls/backgrounds')
  const video = overview.assets.find(asset => asset.kind === 'video' && asset.active && asset.state === 'ready')
  const bed = overview.assets.find(asset => asset.kind === 'bed' && asset.active && asset.state === 'ready')
  assert.ok(video && bed, 'Configure the owned Karaoke video and instrumental before queuing the singer')
  await call('rooms/1/karaoke-calls/backgrounds', { ...overview.settings, videoMode: 'single', videoId: video.id, bedMode: 'single', bedId: bed.id,
    mascotImageId, entryEffectId: entry.id, countdownEffectId: null, endedEffectId: null }, 'PUT')
  await page.goto(uiBase + 'admin/settings/karaoke?view=settings')
  const applause = page.getByRole('group', { name: 'Aplausos', exact: true })
  await applause.getByRole('combobox', { name: 'Aplauso de inicio', exact: true }).selectOption(effect.id)
  await applause.getByRole('combobox', { name: 'Aplauso de cierre', exact: true }).selectOption(effect.id)
  await page.getByRole('region', { name: 'Fondos de karaoke', exact: true }).getByRole('button', { name: 'Guardar configuración', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await call('rooms/1/karaoke-calls/backgrounds')).settings.countdownEffectId).toBe(effect.id)
  const saved = await call('rooms/1/karaoke-calls/backgrounds')
  const configured = saved.settings
  assert.equal(configured.endedEffectId, effect.id)
  assert.equal(saved.assets.find(asset => asset.id === effect.id).active, true, 'Assigning a prepared applause enables it without another activation control')
  const publicUses = db.prepare('SELECT count(*) n FROM animationInterventions').get().n
  const privateStarts = await page.evaluate(() => window.callTrace.starts.length)
  const listenStart = applause.getByRole('button', { name: 'Escuchar inicio', exact: true })
  // The API can confirm the save before the UI receives its response and
  // re-enables the fieldset. Focusing a disabled button silently does nothing.
  await expect(listenStart).toBeEnabled()
  await listenStart.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(index => window.callTrace.starts[index]?.audioEndedAt ?? null, privateStarts), { timeout: 10000 }).not.toBeNull()
  const listenEnd = applause.getByRole('button', { name: 'Escuchar cierre', exact: true })
  await expect(listenEnd).toBeEnabled()
  await listenEnd.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(index => window.callTrace.starts[index]?.audioEndedAt ?? null, privateStarts + 1), { timeout: 10000 }).not.toBeNull()
  const auditions = await page.evaluate(index => window.callTrace.starts.slice(index).map(run => (run.audioEndedAt - run.audioStartedAt) * 1000), privateStarts)
  assert.ok(auditions[0] > 4000 && auditions[0] <= 4600, `Expected a complete private start: ${auditions[0]}`)
  assert.ok(auditions[1] > 4000 && auditions[1] <= 4600, `Expected a complete private closing: ${auditions[1]}`)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, publicUses, 'Private applause listening must not reserve public playback')
  await page.reload()
  await expect(applause.getByRole('combobox', { name: 'Aplauso de inicio', exact: true })).toHaveValue(effect.id)
  await expect(applause.getByRole('combobox', { name: 'Aplauso de cierre', exact: true })).toHaveValue(effect.id)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await applause.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `karaoke-applause-settings-${width}.png`) })
  }
  console.log(`Applause assignments: one prepared file, automatic availability on save, persisted independent selectors and private ${Math.round(auditions[0])}ms/${Math.round(auditions[1])}ms listening passed.`)
  const voice = await call('rooms/1/karaoke-calls/reminder', { requestId: crypto.randomUUID() })
  await expect.poll(async () => (await call(`rooms/1/karaoke-calls/jobs/${voice.id}`)).status, { timeout: 20000 }).toBe('ready')
  assert.ok((await call('rooms/1/karaoke-calls')).reminder?.id, 'The reusable reminder must survive worker cleanup')
  await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Previsualizar llamado', exact: true })
  const privatePlayer = preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true })
  await expect(privatePlayer.getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()
  const beforeEntry = await page.evaluate(() => window.callTrace.starts.length)
  await privatePlayer.locator('audio').first().evaluate((audio) => {
    window.privateEntryVoiceAt = null
    audio.addEventListener('playing', () => {
      window.privateEntryVoiceAt = performance.now()
      window.privateEntryWasActive = window.callTrace.starts.at(-1).endedAt === null
      // The synthetic preview voice lasts only 600 ms. Pause on its native
      // start so actionability scrolling cannot turn this into a countdown click.
      const pause = [...audio.closest('section').querySelectorAll('button')].find(button => button.textContent === 'Pausar')
      pause.click()
    }, { once: true })
  })
  await privatePlayer.getByRole('button', { name: 'Reproducir', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.privateEntryVoiceAt !== null, undefined, { timeout: 10000 })
  const overlap = await page.evaluate(index => ({ effect: window.callTrace.starts[index], voiceAt: window.privateEntryVoiceAt, activeAtVoice: window.privateEntryWasActive }), beforeEntry)
  assert.equal(overlap.effect.checksum, entry.checksum)
  assert.ok(overlap.voiceAt - overlap.effect.at >= 1450 && overlap.voiceAt - overlap.effect.at < 2500, 'Private voice starts after the 1.5-second attack')
  assert.equal(overlap.activeAtVoice, true, 'Private speech overlaps the whoosh tail')
  await expect.poll(() => page.evaluate(index => window.callTrace.starts[index].endedAt, beforeEntry)).not.toBeNull()
  assert.ok(await privatePlayer.locator('audio').evaluateAll(elements => elements.every(audio => audio.paused)), 'Pause stops private speech and music together with the entry')
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, publicUses, 'Private overlap never reserves public audio')
  fs.writeFileSync(path.join(data, 'karaoke-private-entry.json'), JSON.stringify(overlap, null, 2))
  await preview.getByRole('button', { name: 'Cerrar', exact: true }).click()
  console.log(`Private entrance: overlapping voice after ${Math.round(overlap.voiceAt - overlap.effect.at)}ms, keyboard start and complete pause cleanup passed.`)
  return { original, configured, entry, effect, mascotImageId, video, bed }
}

export async function observeKaraokeStage (player) {
  await player.evaluate(() => {
    window.karaokeStage = { timeOrigin: performance.timeOrigin, samples: [] }
    const painted = (element) => {
      if (!element || !element.getClientRects().length) return false
      for (let node = element; node && node.id !== 'player-fs-container'; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.01) return false
      }
      return true
    }
    window.karaokeStageTimer = setInterval(() => {
      const scene = document.querySelector('[data-testid="transition-scene"]')
      const singer = document.querySelector('[data-testid="transition-incoming"] h1')
      const message = document.querySelector('[data-karaoke-participation]')
      const video = document.querySelector('#player-fs-container video:not([data-media-role])')
      const samples = window.karaokeStage.samples
      samples.push({ at: performance.now(), sceneId: scene?.dataset.sceneId, sceneVisible: painted(scene), sceneOpacity: scene ? Number(getComputedStyle(scene).opacity) : 0,
        singerVisible: painted(singer), messageVisible: painted(message), mascotVisible: painted(document.querySelector('[data-testid="karaoke-mascot"]')),
        countdownVisible: painted(document.querySelector('[aria-label="Cuenta regresiva de karaoke"]')),
        mediaId: Number(/\/api\/media\/(\d+)/.exec(video?.currentSrc ?? '')?.[1] ?? 0),
        musicPlaying: !!video && !video.paused && !video.ended, musicVisible: painted(video) && video.readyState >= 2, musicVolume: video?.volume ?? 0,
        levels: window.callTrace.levels() })
      if (samples.length > 4000) samples.shift()
    }, 50)
  })
}

export async function assertKaraokeArrival ({ player, db, queueId, stage, followingIds, data }) {
  await expect(player.getByTestId('karaoke-mascot').locator('img')).toHaveAttribute('src', new RegExp(stage.mascotImageId))
  await expect.poll(() => player.getByTestId('karaoke-mascot').locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(player.locator('[data-testid="transition-incoming"]')).toHaveAttribute('data-queue-id', String(queueId))
  const entries = db.prepare(`SELECT * FROM animationInterventions WHERE json_extract(karaokeCueJSON,'$.queueId')=? AND json_extract(karaokeCueJSON,'$.kind')='entry'`).all(queueId)
  assert.equal(entries.length, 0, 'The entrance must not create a second exclusive reservation')
  const call = db.prepare(`SELECT * FROM animationInterventions WHERE json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL`).get(queueId)
  assert.equal(call.status, 'PLAYED')
  assert.equal(call.clipId, stage.entry.id)
  const sequence = JSON.parse(call.sequenceJSON)
  assert.equal(sequence[0].role, 'entry')
  const speech = sequence.find(asset => asset.role === 'call')
  const starts = await player.evaluate(() => window.callTrace.starts)
  const effectRun = starts.find(start => start.checksum === stage.entry.checksum)
  const voiceRun = starts.find(start => start.checksum === speech.checksum && start.at >= effectRun.at)
  assert.ok(voiceRun.at - effectRun.at >= 1450 && voiceRun.at - effectRun.at < 2500, `Voice follows the 1.5-second attack, not the full whoosh: ${voiceRun.at - effectRun.at}ms`)
  assert.ok(voiceRun.at < effectRun.endedAt, 'Whoosh tail overlaps the presentation')
  const frozen = JSON.parse(db.prepare('SELECT mediaJSON FROM karaokeBackgroundScenes WHERE queueId=?').get(queueId).mediaJSON)
  assert.equal(frozen.background.resource.id, stage.video.id)
  assert.equal(frozen.bed.id, stage.bed.id)
  assert.deepEqual(await player.getByRole('complementary', { name: 'Próximos turnos' }).locator('li').evaluateAll(items => items.map(item => Number(item.dataset.queueId))), followingIds)
  const tableBox = await player.getByRole('complementary', { name: 'Próximos turnos' }).boundingBox()
  for (const notice of await player.getByText('Prepárate para cantar', { exact: true }).all()) {
    const box = await notice.boundingBox()
    assert.ok(!box || box.y + box.height <= tableBox.y || box.y >= tableBox.y + tableBox.height, 'The waiting status must not cover upcoming turns')
  }
  await player.screenshot({ path: path.join(data, 'karaoke-queue-arrival.png') })
}

export async function assertKaraokeHandoff ({ player, queueId, data }) {
  const video = player.locator('#player-fs-container video:not([data-media-role])').first()
  await expect.poll(() => video.evaluate(video => !video.paused && video.readyState >= 2), { timeout: 15000 }).toBe(true)
  await expect.poll(() => player.getByTestId('transition-scene').count(), { timeout: 5000 }).toBe(0)
  await expect(player.getByTestId('karaoke-mascot')).toHaveCount(0)
  await expect.poll(() => video.evaluate(video => video.volume)).toBeGreaterThan(0)
  await player.screenshot({ path: path.join(data, `karaoke-queue-song-${queueId}.png`) })
}

export async function recordKaraokeChoreography ({ player, db, queueId, stage, data, waitMs }) {
  const evidence = await player.evaluate(() => {
    clearInterval(window.karaokeStageTimer)
    return { ...window.karaokeStage, starts: window.callTrace.starts, playback: window.karaokePlaybackTrace.snapshot() }
  })
  const cues = db.prepare(`SELECT interventionId,status,clipId,requestedAt,startedAt,finishedAt,karaokeCueJSON,sequenceJSON FROM animationInterventions
    WHERE json_extract(karaokeCueJSON,'$.queueId')=? ORDER BY requestedAt`).all(queueId)
  const reminders = cues.filter(row => JSON.parse(row.karaokeCueJSON).kind === 'reminder' && row.status === 'PLAYED')
  const firstCountdown = cues.find(row => JSON.parse(row.karaokeCueJSON).kind === 'countdown')
  fs.writeFileSync(path.join(data, 'karaoke-queue-choreography.json'), JSON.stringify({ fidelity: 'isolated-real-queue-with-synthetic-media', queueId, waitMs,
    configured: stage.configured, targetMediaId: stage.mediaId, cues, ...evidence }, null, 2))
  fs.writeFileSync(path.join(data, 'karaoke-queue-playback-trace.json'), JSON.stringify(evidence.playback, null, 2))
  const nativeAt = at => at - evidence.timeOrigin
  const countdownAt = evidence.samples.find(sample => sample.countdownVisible)?.at ?? nativeAt(firstCountdown.requestedAt)
  const waiting = evidence.samples.filter(sample => sample.at < countdownAt && sample.sceneVisible)
  assert.ok(waiting.length > 500, 'Observe the real wait, rather than advancing its clock')
  const stableWait = waiting.filter(sample => sample.at > waiting[0].at + 1000)
  assert.ok(stableWait.every(sample => sample.singerVisible && sample.mascotVisible && !(sample.musicPlaying && sample.mediaId === stage.mediaId)), 'After the entrance, singer and cat stay visible; the queued song does not start early')
  if (waitMs >= 60000) assert.ok(waiting.some(sample => sample.messageVisible), 'The 60-second participation scene appears on the public player')
  const countdown = evidence.samples.filter(sample => sample.countdownVisible)
  assert.ok(countdown.length >= 50 && countdown.every(sample => sample.mascotVisible && !sample.musicPlaying), 'The cat remains throughout the countdown, before music starts')
  for (const row of reminders) {
    const spoken = evidence.starts.filter(start => start.at >= nativeAt(row.requestedAt) && start.at < nativeAt(row.finishedAt) + 100
      && JSON.parse(row.sequenceJSON).some(asset => asset.checksum === start.checksum))
    assert.equal(spoken.length, 2, 'Both saved reminder clips actually start in the browser')
    assert.ok(spoken[0].endedAt <= spoken[1].at + 10, 'Table speech finishes before ¡Karaoke! starts')
    const during = waiting.filter(sample => sample.at > spoken[0].at + 300 && sample.at < spoken[1].endedAt)
    assert.ok(during.some(sample => sample.levels.some(level => level.checksum === stage.bed.checksum && level.volume <= stage.configured.bedVolume * 0.35)), 'The instrumental ducks under the reminder')
    const after = waiting.filter(sample => sample.at > spoken[1].endedAt + 400 && sample.at < spoken[1].endedAt + 1500)
    assert.ok(after.some(sample => sample.levels.some(level => level.checksum === stage.bed.checksum && level.volume >= stage.configured.bedVolume * 0.9)), 'The instrumental recovers after the reminder')
  }
  const music = evidence.samples.filter(sample => sample.musicPlaying && sample.mediaId === stage.mediaId)
  assert.ok(music.length, 'Observe actual native Karaoke music playback')
  const handoff = evidence.samples.filter(sample => sample.at >= music[0].at && sample.at <= music[0].at + 1200)
  assert.ok(handoff.every(sample => sample.sceneVisible || sample.musicVisible), 'No black interval between the scene and the native video')
  assert.ok(handoff.some(sample => sample.sceneOpacity > 0 && sample.sceneOpacity < 1), 'The scene dissolves rather than cutting')
  assert.ok(music.every(sample => !sample.levels.some(level => level.checksum === stage.bed.checksum)), 'No waiting instrumental overlaps the Karaoke song')
  const lastCountdown = cues.filter(row => JSON.parse(row.karaokeCueJSON).kind === 'countdown').at(-1)
  const quietCountdown = countdown.filter(sample => sample.at > nativeAt(lastCountdown.startedAt) + 1600 && sample.at < nativeAt(lastCountdown.startedAt) + 3500)
  assert.ok(quietCountdown.length && quietCountdown.every(sample => !sample.levels.some(level => level.checksum === stage.bed.checksum)), 'The 1.2-second fade ends before the rest of the countdown')
  assert.ok(lastCountdown.finishedAt > evidence.timeOrigin + music[0].at, 'The complete countdown applause continues over the start of Karaoke music')
  const summary = { result: 'PASS', fidelity: 'isolated-real-queue-with-synthetic-media', queueId, waitMs,
    checks: ['configuration-before-queue-arrival', 'entry-overlap-in-one-reservation', 'configured-video-and-bed', 'three-scheduler-ordered-upcoming-turns',
      'persistent-singer-and-mascot', ...(waitMs >= 60000 ? ['natural-60-second-visual-cycle'] : []), '10-second-table-reminders', 'native-ducking-and-recovery',
      'countdown-cancel-and-reconfirm', 'instrumental-fade-before-music', 'native-video-dissolve-without-black', 'applause-tail-over-music-without-ambient', 'natural-end-applause'],
    reminderCount: reminders.length, musicObservedMs: music.at(-1).at - music[0].at,
    nativeAudioStarts: evidence.starts.filter(start => start.at >= waiting[0].at).length, snapshots: ['karaoke-queue-arrival.png', `karaoke-queue-song-${queueId}.png`] }
  fs.writeFileSync(path.join(data, 'karaoke-queue-summary.json'), JSON.stringify(summary, null, 2))
  console.log(`Queue choreography: ${summary.checks.length} checks passed; ${reminders.length} native table reminders; configured entry, mix, countdown, video handoff and closing verified.`)
}

export function assertKaraokeReminders (db, queueId, waitMs) {
  const reminders = db.prepare(`SELECT * FROM animationInterventions WHERE json_extract(karaokeCueJSON,'$.queueId')=? AND json_extract(karaokeCueJSON,'$.kind')='reminder' AND startedAt IS NOT NULL ORDER BY startedAt`).all(queueId)
  assert.ok(reminders.length >= Math.floor(waitMs / 10000) - 1, `Expected repeated reminders, got ${reminders.length}; turn=${JSON.stringify(db.prepare('SELECT phase,reminderAt,revision,heartbeatAt FROM karaokeStartTurns WHERE queueId=?').get(queueId))}`)
  for (let index = 1; index < reminders.length; index++) {
    assert.ok(reminders[index].startedAt - reminders[index - 1].startedAt >= 9500, 'No reminder bursts')
  }
  for (const row of reminders) {
    assert.equal(row.status, 'PLAYED')
    assert.equal(JSON.parse(row.sequenceJSON).length, 2)
    assert.equal(db.prepare('SELECT count(*) n FROM audioUsage WHERE sourceId=?').get(`intervention:${row.interventionId}`).n, 2)
  }
}
