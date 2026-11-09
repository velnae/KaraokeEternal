import assert from 'node:assert/strict'
import fs from 'node:fs'
import { expect } from 'playwright/test'

export async function checkBirthdayScene ({ admin, api, base, calls, birthday, data, event, call }) {
  const upload = await api.post(`${base}api/birthdays/upload`, { multipart: { kind: 'intro', file: { name: 'Alternativa.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(`${data}/greeting.wav`) } } })
  assert.equal(upload.status(), 200)
  const alternate = await upload.json()
  const original = await event(birthday.id)
  const originalIntro = original.assets.find(asset => asset.kind === 'intro')
  const providerCount = calls.length
  const card = admin.getByRole('article', { name: 'Cumpleaños de María', exact: true })
  await card.getByRole('button', { name: 'Configurar celebración', exact: true }).focus()
  await admin.keyboard.press('Enter')
  const editor = admin.getByRole('dialog', { name: 'Celebración de María', exact: true })
  await editor.getByRole('combobox', { name: 'Introducción', exact: true }).selectOption(alternate.id)
  await editor.getByRole('button', { name: 'Aplicar selección', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const manual = await event(birthday.id)
  assert.equal(manual.scene.introMode, 'manual')
  assert.equal(manual.assets.find(asset => asset.kind === 'greeting').id, original.assets.find(asset => asset.kind === 'greeting').id)
  assert.equal(manual.script, original.script)
  await card.getByRole('button', { name: 'Configurar celebración', exact: true }).click()
  await editor.getByRole('button', { name: 'Volver a la propuesta automática', exact: true }).click()
  await expect(editor).toHaveCount(0)
  assert.equal((await event(birthday.id)).assets.find(asset => asset.kind === 'intro').id, originalIntro.id)
  await card.getByRole('button', { name: 'Previsualizar celebración', exact: true }).focus()
  await admin.keyboard.press('Enter')
  const preview = admin.getByRole('dialog', { name: 'Previsualización de María', exact: true })
  await preview.getByRole('button', { name: 'Iniciar previsualización', exact: true }).click()
  await expect.poll(() => preview.locator('audio').evaluate(audio => audio.paused)).toBe(false)
  assert.equal(await preview.locator('video').evaluate(video => video.muted), true)
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    assert.ok(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await admin.screenshot({ path: `${data}/celebration-preview-${width}.png` })
  }
  await expect(preview.getByRole('status')).toHaveText('Canción de cumpleaños', { timeout: 20000 })
  await expect(preview.getByRole('status')).toHaveText('Previsualización finalizada', { timeout: 20000 })
  assert.equal((await event(birthday.id)).playback, 'held')
  const audio = await preview.locator('audio').elementHandle()
  const video = await preview.locator('video').elementHandle()
  await preview.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  await expect.poll(() => preview.locator('audio').evaluate(audio => audio.paused)).toBe(false)
  await preview.getByRole('button', { name: 'Detener', exact: true }).click()
  assert.equal(await audio.evaluate(element => element.paused), true)
  await preview.getByRole('button', { name: 'Reiniciar', exact: true }).click()
  await preview.getByRole('button', { name: 'Cerrar previsualización', exact: true }).click()
  assert.equal(await audio.evaluate(element => element.paused), true)
  assert.equal(await video.evaluate(element => element.paused), true)
  assert.equal(calls.length, providerCount, 'Scene adjustments and full local preview never call providers')
  const current = await event(birthday.id)
  assert.equal(current.playback, 'held')
  birthday.revision = current.revision
  // Keep the alternative available for bank management without changing playback fixtures.
  const overview = await call('birthdays/')
  await call('birthdays/settings', { ...overview.settings, introIds: [originalIntro.id, alternate.id] }, 'PUT')
}
