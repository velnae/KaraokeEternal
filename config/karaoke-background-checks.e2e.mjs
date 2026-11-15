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
  await settings.getByRole('button', { name: 'Guardar fondos', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(settings.getByRole('status')).toHaveText('Fondos guardados.')
  await page.reload()
  await expect(settings.getByRole('combobox', { name: 'Video fijo', exact: true })).toHaveValue(firstVideo.id)
  await expect(settings.getByLabel('Volumen del fondo (%)', { exact: true })).toHaveValue('12')
  assert.equal(db.prepare('SELECT count(*) n FROM audioResources').get().n, catalog)
  assert.equal(db.prepare('SELECT count(*) n FROM transitionVideos').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM birthdayAssets').get().n, 0)
  console.log('Karaoke backgrounds: own uploads, inactive admission, keyboard activation, fixed selection, independent volume, persistence and isolated catalogs passed.')
  return { video: firstVideo, bed: firstBed, extra }
}

export async function checkKaraokePreview ({ page, preview, data, db, media, providerRequests }) {
  const player = preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true })
  const before = providerRequests.length
  const rotation = db.prepare('SELECT id,selectionOrder FROM karaokeBackgroundAssets ORDER BY id').all()
  await expect(player.getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()
  await player.getByRole('button', { name: 'Reproducir', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(player.getByText('Entrada', { exact: true })).toBeVisible()
  await expect.poll(() => player.locator('video').evaluate(video => video.paused)).toBe(false)
  await player.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect.poll(() => player.locator('audio').evaluateAll(elements => elements.every(audio => audio.paused))).toBe(true)
  await player.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(player.getByText('Esperando inicio', { exact: true })).toBeVisible({ timeout: 15000 })
  await player.getByRole('button', { name: 'Iniciar karaoke', exact: true }).click()
  await expect(player.getByRole('status', { name: 'Cuenta regresiva de karaoke', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await player.screenshot({ path: path.join(data, `karaoke-preview-countdown-${width}.png`) })
  }
  await expect(player.getByText('Previsualización finalizada', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect.poll(() => player.locator('audio').evaluateAll(elements => elements.every(audio => audio.paused))).toBe(true)
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
    await player.screenshot({ path: path.join(data, `karaoke-preview-stage-${width}.png`) })
  }
  console.log('Karaoke preview: real presentation, video/bed/voice sequence, pause/resume/restart, variant cleanup, no synthesis or public playback/rotation and responsive layout passed.')
}
