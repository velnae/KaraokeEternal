import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from 'playwright/test'

export async function checkPreviewRetention ({ page, api, base, uiBase, data, call, providerRequests }) {
  const count = providerRequests.length
  await page.goto(uiBase + 'admin/settings/karaoke?view=settings')
  await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
  const karaoke = page.getByRole('dialog', { name: 'Previsualizar llamado', exact: true })
  const saved = await call('rooms/1/karaoke-calls/preview')
  // Playback recovery checks deliberately remove a shared hybrid's files. This
  // scenario restores an available immutable sample, not that corrupted asset.
  const key = Object.keys(saved.savedDrafts).find(key => saved.samples[key]?.result)
  assert.ok(key, 'An available saved preview is required for retention checks')
  const original = saved.savedDrafts[key]
  const savedSelect = karaoke.getByRole('combobox', { name: 'Pruebas guardadas', exact: true })
  await savedSelect.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await savedSelect.selectOption(key)
  await expect(karaoke.getByLabel('Mesa', { exact: true })).toHaveValue(original.tableId)
  await expect(karaoke.getByLabel('Canción', { exact: true })).toHaveValue(original.song)
  await expect(karaoke.getByRole('region', { name: 'Previsualización audiovisual', exact: true }).getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()

  // Lose every PUT, then reload immediately: only the synchronous account-
  // scoped pending copy can retain this edit. Recovery must later reach SQLite.
  const endpoint = '**/api/rooms/1/karaoke-calls/preview'
  const offline = route => route.request().method() === 'PUT' ? route.abort() : route.fallback()
  await page.route(endpoint, offline)
  await karaoke.getByLabel('Canción', { exact: true }).fill('Última edición antes de refrescar')
  await page.reload()
  await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
  await expect(karaoke.getByLabel('Canción', { exact: true })).toHaveValue('Última edición antes de refrescar')
  await page.unroute(endpoint, offline)
  await page.reload()
  await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
  await expect.poll(async () => (await call('rooms/1/karaoke-calls/preview')).draft.song).toBe('Última edición antes de refrescar')
  await karaoke.getByRole('combobox', { name: 'Pruebas guardadas', exact: true }).selectOption(key)
  await expect(karaoke.getByLabel('Canción', { exact: true })).toHaveValue(original.song)
  assert.equal(providerRequests.length, count)
  await page.keyboard.press('Escape')

  const resources = {}
  for (const kind of ['intro', 'music']) {
    const response = await api.post(base + 'api/birthdays/upload', { multipart: { kind, file: { name: `${kind}.wav`, mimeType: 'audio/wav', buffer: fs.readFileSync(path.join(data, 'source.wav')) } } })
    assert.equal(response.status(), 200, await response.text())
    resources[kind] = await response.json()
  }
  const video = await api.post(base + 'api/birthdays/video/upload', { multipart: { file: { name: 'preview.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(path.join(data, 'karaoke-blue.mp4')) } } })
  assert.equal(video.status(), 200, await video.text())
  resources.video = await video.json()
  const birthday = await call('birthdays/')
  await call('birthdays/settings', { ...birthday.settings, defaultVoiceId: 'Puck', speechProvider: 'gemini', speechModel: 'gemini-3.8-flash-tts', speechStyle: 'Original warm delivery.',
    introId: resources.intro.id, musicId: resources.music.id, videoId: resources.video.id, rules: [] }, 'PUT')
  await page.goto(uiBase + 'admin/settings/birthdays?view=settings')
  await page.getByRole('button', { name: 'Previsualizar cumpleaños', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Previsualizar cumpleaños', exact: true })
  const play = preview.getByRole('button', { name: 'Reproducir', exact: true })
  await preview.getByRole('button', { name: 'Generar audio', exact: true }).click()
  await expect(play).toBeEnabled({ timeout: 20000 })
  const prepared = await call('birthdays/preview/1')
  const sampleKey = Object.keys(prepared.samples)[0]
  const asset = prepared.samples[sampleKey]
  const afterGeneration = providerRequests.length
  const current = await call('birthdays/')
  await call('birthdays/settings', { ...current.settings, speechStyle: 'New delivery with a pause after the name.' }, 'PUT')
  await page.reload()
  await page.getByRole('button', { name: 'Previsualizar cumpleaños', exact: true }).click()
  await expect(play).toBeEnabled()
  await expect(preview.getByText('Audio guardado con una configuración de voz anterior.', { exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Generar con voz actual', exact: true })).toBeVisible()
  await preview.getByLabel('Nombre de prueba', { exact: true }).fill('Borrador distinto')
  await expect(play).toBeDisabled()
  await preview.getByRole('combobox', { name: 'Pruebas guardadas', exact: true }).selectOption(sampleKey)
  await expect(preview.getByLabel('Nombre de prueba', { exact: true })).toHaveValue('Carlos')
  await expect(preview.getByRole('textbox', { name: 'Saludo de prueba', exact: true })).toHaveValue(asset.script)
  await expect(play).toBeEnabled()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    assert.ok(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await preview.getByRole('combobox', { name: 'Pruebas guardadas', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(data, `birthday-retention-${width}.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(preview).not.toBeVisible()
  // End the session, then sign in again in the same browser profile.
  await page.evaluate(async () => {
    await fetch(new URL('api/logout', document.baseURI))
  })
  await page.goto(uiBase + 'account?roomId=1')
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('call-pilot-test')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Secciones de administración' })).toBeVisible()
  await page.goto(uiBase + 'admin/settings/birthdays?view=settings')
  await page.getByRole('button', { name: 'Previsualizar cumpleaños', exact: true }).click()
  await expect(play).toBeEnabled()
  assert.equal((await call('birthdays/preview/1')).samples[sampleKey].id, asset.id)
  assert.equal(providerRequests.length, afterGeneration)
  await page.keyboard.press('Escape')
  console.log('Preview retention: saved-trial keyboard restore, immediate offline refresh/recovery to SQLite, changed voice playback, mobile/desktop and new login without synthesis passed.')
}
