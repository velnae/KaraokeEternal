import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { expandSceneProperties, sceneTemplateAction } from './event-scene-test-helpers.e2e.mjs'

export async function checkSceneRegressions ({ player, uiBase, call, voice, effect, data }) {
  const baseline = (await call('animation/scenes/')).settings
  const button = name => player.getByRole('button', { name, exact: true })
  const timeline = player.getByRole('group', { name: 'Línea de tiempo', exact: true })
  const preview = player.getByRole('region', { name: 'Vista previa de la coreografía', exact: true })
  const properties = player.getByRole('region', { name: 'Propiedades del elemento', exact: true })
  const timing = player.getByRole('region', { name: 'Tiempo del bloque', exact: true })
  const canvas = player.getByLabel('Lienzo de la escena', { exact: true })
  const template = player.getByRole('combobox', { name: 'Plantilla', exact: true })
  const reset = async () => {
    const discard = button('Descartar cambios')
    if (await discard.isVisible() && await discard.isEnabled()) await discard.click()
    const current = (await call('animation/scenes/')).settings
    await call('animation/scenes/', { ...structuredClone(baseline), revision: current.revision }, 'PUT')
    await player.goto(`${uiBase}admin/settings/animator?view=scenes`)
    await player.getByRole('combobox', { name: 'Evento', exact: true }).selectOption('transition')
  }
  const main = async () => {
    await timeline.getByRole('button', { name: /^Presentación del pedido/ }).click()
    await properties.getByRole('combobox', { name: /^Recurso/ }).selectOption(voice.id)
  }

  await reset()
  await preview.getByRole('checkbox', { name: 'Solo imagen', exact: true }).check()
  await main()
  await expect(preview.getByRole('checkbox', { name: 'Solo imagen', exact: true })).toHaveCount(0)
  await player.evaluate(() => {
    window.scenePreviewSources = 0
    window.scenePreviewStart = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.scenePreviewSources++
      return window.scenePreviewStart.apply(this, args)
    }
  })
  try {
    await preview.getByRole('button', { name: 'Previsualizar', exact: true }).click()
    await expect(preview.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    await expect.poll(() => player.evaluate(() => window.scenePreviewSources)).toBeGreaterThan(0)
    await preview.getByRole('button', { name: 'Detener', exact: true }).click()
  } finally {
    await player.evaluate(() => {
      AudioBufferSourceNode.prototype.start = window.scenePreviewStart
    })
  }
  console.log('PASS resolving a missing preview sample restores audio after image-only mode')

  await reset()
  await main()
  await button('Guardar y usar').click()
  await expect(player.getByText('Plantilla en uso.', { exact: true })).toBeVisible()
  const saved = (await call('animation/scenes/')).settings
  await button('Agregar audio').click()
  await player.getByRole('dialog').getByRole('searchbox').fill(effect.title)
  await player.getByRole('dialog').getByRole('button', { name: `Agregar ${effect.title}`, exact: true }).click()
  await timing.getByRole('combobox', { name: /^Referencia/ }).selectOption('start')
  await player.getByLabel('Desplazamiento (s)', { exact: true }).fill('2')
  await button('Guardar').click()
  await expect(player.getByRole('alert').filter({ hasText: 'superponerse' }).first()).toBeVisible()
  assert.deepEqual((await call('animation/scenes/')).settings, saved, 'invalid edits must not replace the active template')
  await timing.getByRole('combobox', { name: /^Referencia/ }).selectOption('block:announcement')
  await timing.getByRole('combobox', { name: /^Momento del bloque/ }).selectOption('start')
  await timing.getByRole('combobox', { name: 'Desplazamiento', exact: true }).selectOption('before')
  await player.getByLabel('Desplazamiento (s)', { exact: true }).fill('3')
  await button('Guardar').click()
  await expect(player.getByRole('alert').filter({ hasText: 'antes del inicio' }).first()).toBeVisible()
  assert.deepEqual((await call('animation/scenes/')).settings, saved)
  console.log('PASS Guardar rejects overlap and before-origin timing without changing the active revision')

  await reset()
  const original = await template.inputValue()
  await sceneTemplateAction(player, 'Nueva')
  const created = await template.inputValue()
  await button('Deshacer').click()
  await expect(template).toHaveValue(original)
  await expect(canvas).toBeVisible()
  await button('Rehacer').click()
  await expect(template).toHaveValue(created)
  await button('Agregar texto').click()
  await player.getByRole('textbox', { name: 'Texto', exact: true }).fill('Preserved scene draft')
  const tabs = player.getByRole('navigation', { name: 'Ajustes del animador' })
  await tabs.getByRole('link', { name: 'Fondo', exact: true }).click()
  await expect(player).toHaveURL(/view=background/)
  await expect(player.getByRole('region', { name: 'Coreografías', exact: true })).toHaveCount(0)
  await tabs.getByRole('link', { name: 'Coreografías', exact: true }).click()
  await expect(template).toHaveValue(created)
  await expect(canvas.getByRole('button', { name: 'Editar Texto', exact: true })).toContainText('Preserved scene draft')
  await player.getByRole('link', { name: 'Cola', exact: true }).first().click()
  await expect(player).toHaveURL(/\/queue$/)
  await player.goBack()
  await expect(template).toHaveValue(created)
  await expect(canvas.getByRole('button', { name: 'Editar Texto', exact: true })).toContainText('Preserved scene draft')
  await button('Descartar cambios').click()
  await expect(template).toHaveValue(original)
  await expect(canvas).toBeVisible()
  console.log('PASS new-template undo/redo restores selection, SPA navigation preserves draft and discard restores the saved scene')

  await reset()
  const second = await player.context().newPage()
  try {
    await second.goto(`${uiBase}admin/settings/animator?view=scenes`)
    await second.getByRole('combobox', { name: 'Evento', exact: true }).selectOption('transition')
    await second.getByRole('button', { name: 'Agregar texto', exact: true }).click()
    await second.getByRole('textbox', { name: 'Texto', exact: true }).fill('Conflicting draft')
    await button('Agregar texto').click()
    await player.getByRole('textbox', { name: 'Texto', exact: true }).fill('Saved by first editor')
    await button('Guardar').click()
    await expect(player.getByText('Coreografía guardada.', { exact: true })).toBeVisible()
    await second.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(second.getByRole('alert')).toContainText('Recargue')
    await expect(second.getByRole('textbox', { name: 'Texto', exact: true })).toHaveValue('Conflicting draft')
    await second.getByRole('button', { name: 'Recargar', exact: true }).click()
    await expect(second.getByLabel('Lienzo de la escena', { exact: true })).toContainText('Saved by first editor')
    await expect(second.getByText('Cambios sin guardar', { exact: true })).toHaveCount(0)
  } finally { await second.close() }
  console.log('PASS stale saves preserve the draft and explicit reload replaces it with the current saved version')

  await reset()
  await button('Agregar texto').click()
  await player.getByRole('textbox', { name: 'Texto', exact: true }).fill('Text bounds')
  await expandSceneProperties(player)
  const text = canvas.getByRole('button', { name: 'Editar Texto', exact: true })
  const inside = async () => {
    const frame = await canvas.boundingBox()
    const box = await text.boundingBox()
    return box.y >= frame.y - 1 && box.y + box.height <= frame.y + frame.height + 1
  }
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await player.setViewportSize({ width, height })
    await player.getByLabel('Tamaño del texto (FHD)').fill('72')
    await player.getByLabel('Posición Y (%)').fill('95')
    await expect.poll(inside).toBe(true)
    assert.ok(Number(await player.getByLabel('Posición Y (%)').inputValue()) < 95)
    await text.focus()
    await text.press('Shift+ArrowDown')
    await expect.poll(inside).toBe(true)
    await player.getByLabel('Tamaño del texto (FHD)').fill('120')
    await expect.poll(inside).toBe(true)
    assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await canvas.screenshot({ path: path.join(data, `scene-text-bounds-${width}.png`) })
    await properties.screenshot({ path: path.join(data, `scene-text-properties-${width}.png`) })
  }
  await player.setViewportSize({ width: 1440, height: 1000 })
  await button('Guardar').click()
  await expect(player.getByText('Coreografía guardada.', { exact: true })).toBeVisible()
  await player.getByRole('textbox', { name: 'Texto', exact: true }).fill('Changed after saving')
  await expect(player.getByText('Coreografía guardada.', { exact: true })).toHaveCount(0)
  await expect(player.getByText('Cambios sin guardar', { exact: true })).toBeVisible()
  console.log('PASS numeric/keyboard/font edits keep text inside desktop/mobile canvas; editing clears the saved notice')
  await reset()
}
