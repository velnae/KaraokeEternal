import { expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function checkKaraokeBackgrounds ({ page, api, base, uiBase, data, db, call }) {
  const catalog = db.prepare('SELECT count(*) n FROM audioResources').get().n
  const video = path.join(data, 'karaoke-blue.mp4')
  const secondVideo = path.join(data, 'karaoke-red.mp4')
  const bed = path.join(data, 'karaoke-bed.wav')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', video])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=10', '-t', '2', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', secondVideo])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=44100', '-t', '129.8', bed])
  const overview = () => call('rooms/1/karaoke-calls/backgrounds')
  await page.goto(uiBase + 'admin/settings/karaoke?view=settings')
  const settings = page.getByRole('region', { name: 'Fondos de karaoke', exact: true })
  for (const [kind, file, label] of [['video', video, 'Subir video'], ['bed', bed, 'Subir audio de fondo']]) {
    const uploadPattern = '**/rooms/1/karaoke-calls/backgrounds/upload'
    const forwardUpload = async (route) => {
      // Chromium omits file bytes from intercepted multipart postData. Keep the
      // selected fixture bytes when bridging the HTTPS UI to the isolated API.
      const body = route.request().postData() ?? ''
      const requestId = /name="requestId"\r\n\r\n([^\r\n]+)/.exec(body)?.[1]
      assert.ok(requestId)
      assert.ok(body.includes(`name="kind"\r\n\r\n${kind}`))
      const response = await api.post(base + 'api/rooms/1/karaoke-calls/backgrounds/upload', { multipart: {
        kind, requestId, file: { name: path.basename(file), mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav', buffer: fs.readFileSync(file) },
      } })
      await route.fulfill({ response })
    }
    if (uiBase !== base) await page.route(uploadPattern, forwardUpload)
    await settings.getByLabel(label, { exact: true }).setInputFiles(file)
    await expect.poll(async () => (await overview()).assets.find(item => item.kind === kind)?.state, { timeout: 30000 }).toBe('ready')
    if (uiBase !== base) await page.unroute(uploadPattern, forwardUpload)
    const checkbox = settings.getByRole('checkbox', { name: `Activar ${path.basename(file)}`, exact: true })
    await checkbox.focus()
    await page.keyboard.press('Space')
    await expect(checkbox).toBeChecked()
  }
  const response = await api.post(base + 'api/rooms/1/karaoke-calls/backgrounds/upload', { multipart: {
    kind: 'video', requestId: crypto.randomUUID(), file: { name: path.basename(secondVideo), mimeType: 'video/mp4', buffer: fs.readFileSync(secondVideo) },
  } })
  assert.equal(response.status(), 202, await response.text())
  const extra = await response.json()
  assert.equal(extra.state, 'ready')
  await call(`rooms/1/karaoke-calls/backgrounds/assets/${extra.id}`, { active: true }, 'PATCH')
  await page.reload()
  const assets = (await overview()).assets
  const firstVideo = assets.find(item => item.title === path.basename(video))
  const firstBed = assets.find(item => item.kind === 'bed')
  await settings.getByRole('combobox', { name: 'Modo de video', exact: true }).selectOption('single')
  await settings.getByRole('combobox', { name: 'Video fijo', exact: true }).selectOption(firstVideo.id)
  await settings.getByRole('combobox', { name: 'Modo de audio', exact: true }).selectOption('single')
  await settings.getByRole('combobox', { name: 'Audio fijo', exact: true }).selectOption(firstBed.id)
  await settings.getByLabel('Volumen del fondo (%)', { exact: true }).fill('12')
  await settings.getByRole('button', { name: 'Guardar configuración', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(settings.getByRole('status')).toHaveText('Configuración guardada.')
  await page.reload()
  await expect(settings.getByRole('combobox', { name: 'Video fijo', exact: true })).toHaveValue(firstVideo.id)
  await expect(settings.getByLabel('Volumen del fondo (%)', { exact: true })).toHaveValue('12')
  assert.equal(db.prepare('SELECT count(*) n FROM audioResources').get().n, catalog)
  assert.equal(db.prepare('SELECT count(*) n FROM transitionVideos').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM birthdayAssets').get().n, 0)
  console.log('Karaoke backgrounds: own uploads, inactive admission, keyboard activation, fixed selection, independent volume, persistence and isolated catalogs passed.')
  return { video: firstVideo, bed: firstBed, extra }
}

export async function checkKaraokePreview ({ page, preview, data, db, media, providerRequests, call }) {
  const player = preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true })
  const job = await call('rooms/1/karaoke-calls/reminder', { requestId: crypto.randomUUID() })
  await expect.poll(async () => (await call(`rooms/1/karaoke-calls/jobs/${job.id}`)).status, { timeout: 20000 }).toBe('ready')
  const audioReady = (await call('rooms/1/karaoke-calls')).reminder
  assert.ok(audioReady)
  await page.evaluate(() => {
    window.previewReminderRuns = []
    const create = AudioContext.prototype.createBufferSource
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this)
      const start = source.start.bind(source)
      source.start = (...args) => {
        const run = { at: performance.now(), audioAt: source.context.currentTime, duration: source.buffer.duration, end: null }
        window.previewReminderRuns.push(run)
        source.addEventListener('ended', () => {
          run.end = source.context.currentTime
        })
        return start(...args)
      }
      return source
    }
  })
  let polls = 0
  const refreshed = (response) => {
    if (response.request().method() === 'GET' && /\/api\/rooms\/1\/karaoke-calls$/.test(new URL(response.url()).pathname)) polls++
  }
  page.on('response', refreshed)
  const before = providerRequests.length
  const rotation = db.prepare('SELECT id,selectionOrder FROM karaokeBackgroundAssets ORDER BY id').all()
  await expect(player.getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()
  await player.getByRole('button', { name: 'Reproducir', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(player.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(false)
  await player.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('audio').evaluateAll(elements => elements.every(audio => audio.paused))).toBe(true)
  await player.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(player.getByText('Esperando inicio', { exact: true })).toBeVisible({ timeout: 15000 })
  const waitingAt = await page.evaluate(() => performance.now())
  await page.waitForTimeout(45000)
  const runs = await page.evaluate(() => window.previewReminderRuns)
  assert.ok(polls >= 12, `Keep real snapshot polling active during the preview wait: ${polls}`)
  assert.equal(runs.length, 8, `Expected four table/Karaoke pairs while polling, got ${runs.length}`)
  for (let pair = 0; pair < 4; pair++) {
    const tableRun = runs[pair * 2]
    const karaokeRun = runs[pair * 2 + 1]
    const target = waitingAt + (pair + 1) * 10000
    assert.ok(tableRun.at >= target - 1000 && tableRun.at <= target + 4000, 'Snapshots must not reset the ten-second reminder clock')
    assert.ok(tableRun.end !== null && tableRun.end <= karaokeRun.audioAt + 0.02, 'The table clip finishes before Karaoke starts')
    assert.ok(karaokeRun.end !== null)
  }
  assert.equal(providerRequests.length, before, 'Waiting must reuse saved audio without synthesis')
  await player.getByRole('button', { name: 'Iniciar karaoke', exact: true }).click()
  await expect(player.getByRole('status', { name: 'Cuenta regresiva de karaoke', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await player.screenshot({ path: path.join(data, `karaoke-preview-countdown-${width}.png`) })
  }
  await expect(player.getByText('Previsualización finalizada', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect.poll(() => player.locator('audio').evaluateAll(elements => elements.every(audio => audio.paused))).toBe(true)
  await page.waitForTimeout(16000)
  assert.equal(await page.evaluate(() => window.previewReminderRuns.length), runs.length, 'No reminder survives countdown or scene exit')
  await player.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  await player.locator('audio,video').evaluateAll((elements) => {
    window.previousPreviewMedia = elements
  })
  await preview.getByRole('combobox', { name: 'Video de fondo', exact: true }).selectOption(media.extra.id)
  await expect.poll(() => page.evaluate(() => window.previousPreviewMedia.every(media => media.paused))).toBe(true)
  await expect(player.locator('[data-resource-id]')).toHaveAttribute('data-resource-id', media.extra.id)
  assert.equal(providerRequests.length, before)
  assert.deepEqual(db.prepare('SELECT id,selectionOrder FROM karaokeBackgroundAssets ORDER BY id').all(), rotation)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, 0)
  await player.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect.poll(() => player.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
  await expect(player.locator('[data-video-visible]')).toHaveAttribute('data-video-visible', 'true')
  await player.getByRole('button', { name: 'Pausar', exact: true }).click()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await player.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.ok(await player.locator('[data-testid="transition-incoming"]').evaluate((element) => {
      const left = element.getBoundingClientRect().left
      return [...element.querySelectorAll('h1,p')].every(child => Math.abs(child.getBoundingClientRect().left - left) < 2)
    }), 'Singer, table and song must keep the same left alignment in compact previews')
    await player.screenshot({ path: path.join(data, `karaoke-preview-stage-${width}.png`) })
  }
  await player.getByRole('button', { name: 'Probar espera', exact: true }).click()
  await page.waitForTimeout(250)
  await preview.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await expect(preview).not.toBeVisible()
  const beforeCloseWait = await page.evaluate(() => window.previewReminderRuns.length)
  await page.waitForTimeout(16000)
  assert.equal(await page.evaluate(() => window.previewReminderRuns.length), beforeCloseWait, 'Closing the preview cancels its pending reminder')
  page.off('response', refreshed)
  fs.writeFileSync(path.join(data, 'karaoke-preview-reminders.json'), JSON.stringify({ polls, waitingAt, runs, afterClose: beforeCloseWait }, null, 2))
  await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
  await expect(preview).toBeVisible()
  console.log(`Karaoke private reminders: four native table/Karaoke pairs over 45s and ${polls} snapshots, with countdown/exit/unmount cancellation passed.`)
  console.log('Karaoke preview: real presentation, video/bed/voice sequence, pause/resume/restart, variant cleanup, no synthesis or public playback/rotation and responsive layout passed.')
}
