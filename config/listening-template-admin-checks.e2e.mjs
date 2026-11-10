import { expect } from 'playwright/test'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function checkListeningTemplateAdmin ({ page, db, snapshot, data, first, fail }) {
  const manager = page.getByRole('region', { name: 'Introducciones para escuchar', exact: true })
  const list = async () => (await snapshot()).automation.listeningTemplates
  const row = id => manager.locator(`[data-listening-template="${id}"]`)
  const binding = () => db.prepare('SELECT templateId,templatePartId,resultId FROM listeningPresentations WHERE queueId=?').get(first)
  const sources = () => db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation IN ('source','table') AND (operation='table' OR json_extract(inputJSON,'$.sourceKind')='name')`).get().n
  const before = binding()
  const sourceCount = sources()
  const interventions = db.prepare('SELECT count(*) n FROM animationInterventions').get().n
  const initial = await list()
  assert.equal(initial.length, 3)
  await expect.poll(async () => (await list()).every(item => !!item.audio)).toBe(true)
  const open = async () => {
    await manager.getByRole('button', { name: 'Agregar introducción', exact: true }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Nueva introducción para escuchar', exact: true })
    await expect(dialog.getByLabel('Texto de la introducción')).toBeFocused()
    return dialog
  }
  const submit = async (dialog, text) => {
    await dialog.getByLabel('Texto de la introducción').fill(text)
    await expect(dialog.locator('p[translate="no"]')).toHaveText(`Desde la mesa cinco, ${text} Luis.`)
    await dialog.getByRole('button', { name: 'Generar y guardar', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).not.toBeVisible()
  }
  const options = async (id) => {
    const summary = row(id).locator('summary')
    if (!await row(id).locator('details').evaluate(element => element.open)) {
      await summary.focus()
      await page.keyboard.press('Enter')
    }
  }
  const archive = async (id) => {
    await options(id)
    await row(id).getByRole('button', { name: 'Archivar', exact: true }).click()
    await expect(row(id)).toHaveCount(0)
  }

  const text = 'La música de este momento la elige…'
  await submit(await open(), text)
  await expect.poll(async () => (await list()).find(item => item.text === text)?.audio?.text).toBe(text)
  const created = (await list()).find(item => item.text === text)
  assert.deepEqual(binding(), before)
  assert.equal(sources(), sourceCount)
  await row(created.id).getByRole('button', { name: `Escuchar introducción ${text}`, exact: true }).click()
  await expect(page.getByRole('region', { name: 'Escucha privada' })).toContainText(text)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, interventions)
  const checkbox = row(created.id).getByRole('checkbox')
  await checkbox.focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await list()).find(item => item.id === created.id)?.enabled).toBe(false)
  await page.reload()
  await expect(row(created.id).getByRole('checkbox')).not.toBeChecked()
  await row(created.id).getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await list()).find(item => item.id === created.id)?.enabled).toBe(true)
  await options(created.id)
  await row(created.id).getByRole('button', { name: 'Editar', exact: true }).click()
  const editedText = 'Disfrutamos esta canción gracias a…'
  await submit(page.getByRole('dialog', { name: 'Editar introducción para escuchar', exact: true }), editedText)
  await expect(row(created.id).locator('summary')).toBeFocused()
  await expect.poll(async () => (await list()).find(item => item.id === created.id)?.audio?.text).toBe(editedText)
  assert.deepEqual(binding(), before)
  assert.equal(sources(), sourceCount)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await manager.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await manager.screenshot({ path: path.join(data, `listening-intros-${width}.png`) })
  }
  const dialog = await open()
  await dialog.getByLabel('Texto de la introducción').fill('Este tema llega gracias a…')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await dialog.screenshot({ path: path.join(data, `listening-intro-editor-${width}.png`) })
  }
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(manager.getByRole('button', { name: 'Agregar introducción', exact: true })).toBeFocused()
  await archive(created.id)
  const failingText = 'Por esta elección, agradecemos a…'
  fail(failingText)
  try {
    await submit(await open(), failingText)
    await expect.poll(async () => (await list()).find(item => item.text === failingText)?.status, { timeout: 15000 }).toBe('uncertain')
    const failed = (await list()).find(item => item.text === failingText)
    await expect(row(failed.id).getByRole('alert')).toBeVisible()
    fail('')
    await row(failed.id).getByRole('button', { name: 'Reintentar', exact: true }).click()
    await expect.poll(async () => (await list()).find(item => item.id === failed.id)?.audio?.text).toBe(failingText)
    await archive(failed.id)
  } finally { fail('') }
  assert.equal((await list()).length, 3)
  assert.deepEqual(binding(), before)
  console.log('Listening intro admin: create, private preview, persisted enablement, edit, archive, failed generation/retry, stable pending assignment, keyboard and responsive layout passed.')
}
