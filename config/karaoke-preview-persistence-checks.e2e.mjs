import { expect } from 'playwright/test'
import assert from 'node:assert/strict'

export async function checkKaraokePreviewDefaults ({ preview, db, tableId, introId, media, providerRequests }) {
  const count = providerRequests.length
  await expect(preview.getByLabel('Cantante', { exact: true })).toHaveValue('Ana')
  await expect(preview.getByLabel('Canción', { exact: true })).toHaveValue('Rayando el sol')
  await expect(preview.getByLabel('Mesa', { exact: true })).toHaveValue(String(tableId))
  await expect(preview.getByLabel('Introducción', { exact: true })).toHaveValue(introId)
  await expect(preview.getByLabel('Video de fondo', { exact: true })).toHaveValue(media.video.id)
  await expect(preview.getByLabel('Audio de fondo', { exact: true })).toHaveValue(media.bed.id)
  await expect.poll(() => db.prepare('SELECT revision FROM karaokePreviewDrafts WHERE userId=1 AND roomId=1').get()?.revision).toBeGreaterThan(0)
  const saved = JSON.parse(db.prepare('SELECT draftJSON FROM karaokePreviewDrafts WHERE userId=1 AND roomId=1').get().draftJSON)
  assert.equal(saved.performer, 'Ana')
  assert.equal(saved.tableId, String(tableId))
  assert.equal(providerRequests.length, count)
  console.log('Karaoke preview defaults: complete performer/song/table/intro/video/bed, persisted initial draft and no synthesis on opening passed.')
}

export async function checkKaraokePreviewPersistence ({ page, uiBase, db, call, providerRequests, restart }) {
  const route = uiBase + 'admin/settings/karaoke?view=settings'
  const preview = page.getByRole('dialog', { name: 'Previsualizar llamado', exact: true })
  const open = async () => {
    await page.getByRole('button', { name: 'Previsualizar llamado', exact: true }).click()
    await expect(preview.getByLabel('Cantante', { exact: true })).toBeVisible()
  }
  const state = await call('rooms/1/karaoke-calls/preview')
  const draft = state.draft
  const voice = await preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true }).locator('audio').first().getAttribute('src')
  assert.ok(voice?.includes('/karaoke-calls/audio/'))
  const generated = providerRequests.length
  const samples = db.prepare('SELECT cacheKey,jobId FROM karaokePreviewSamples WHERE userId=1 AND roomId=1 ORDER BY cacheKey').all()
  const verify = async () => {
    await expect(preview.getByLabel('Cantante', { exact: true })).toHaveValue(draft.performer)
    await expect(preview.getByLabel('Canción', { exact: true })).toHaveValue(draft.song)
    await expect(preview.getByLabel('Video de fondo', { exact: true })).toHaveValue(draft.videoId)
    await expect(preview.getByLabel('Audio de fondo', { exact: true })).toHaveValue(draft.bedId)
    await expect(preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true }).getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()
    await expect(preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true }).locator('audio').first()).toHaveAttribute('src', voice)
    assert.equal(providerRequests.length, generated)
  }
  await page.reload()
  await open()
  await verify()
  await preview.getByLabel('Cantante', { exact: true }).fill('Lucía de prueba')
  await preview.getByLabel('Canción', { exact: true }).fill('Vivir mi vida')
  await page.keyboard.press('Escape')
  await expect(preview).not.toBeVisible()
  await page.reload()
  await open()
  await expect(preview.getByLabel('Cantante', { exact: true })).toHaveValue('Lucía de prueba')
  await expect(preview.getByLabel('Canción', { exact: true })).toHaveValue('Vivir mi vida')
  assert.equal(providerRequests.length, generated)
  await preview.getByLabel('Cantante', { exact: true }).fill(draft.performer)
  await preview.getByLabel('Canción', { exact: true }).fill(draft.song)
  await expect(preview.getByRole('region', { name: 'Previsualización audiovisual', exact: true }).getByRole('button', { name: 'Reproducir', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(preview).not.toBeVisible()
  await page.goto('about:blank')
  await restart()
  await page.goto(route)
  await open()
  await verify()
  assert.deepEqual(db.prepare('SELECT cacheKey,jobId FROM karaokePreviewSamples WHERE userId=1 AND roomId=1 ORDER BY cacheKey').all(), samples)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM audioUsage').get().n, 0)
  console.log('Karaoke preview persistence: reload, keyboard close/autosave, changed drafts without synthesis, matching audio reuse and database/server restart passed.')
}
