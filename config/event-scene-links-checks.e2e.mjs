import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkSceneLinks ({ player, authored, voice, data }) {
  const timeline = player.getByRole('group', { name: 'Línea de tiempo', exact: true })
  const timing = player.getByRole('region', { name: 'Tiempo del bloque', exact: true })
  const effect = timeline.locator(`[data-timeline-cue="${authored.effectCueId}"]`)
  const text = timeline.locator(`[data-timeline-cue="${authored.leadTextId}"]`)
  const reference = timing.getByRole('combobox', { name: 'Referencia', exact: true })
  const edge = timing.getByRole('combobox', { name: 'Momento del bloque', exact: true })
  const direction = timing.getByRole('combobox', { name: 'Desplazamiento', exact: true })
  const offset = timing.getByLabel('Desplazamiento (s)', { exact: true })
  const link = () => timeline.locator(`[data-link-to="${authored.leadTextId}"]`)
  const aligned = async () => link().evaluate((group) => {
    const path = group.querySelector('path')
    const endpoint = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM())
    const origin = path.getPointAtLength(0).matrixTransform(path.getScreenCTM())
    const target = document.querySelector(`[data-timeline-cue="${group.dataset.linkTo}"]`).getBoundingClientRect()
    const source = document.querySelector(`[data-timeline-cue="${group.dataset.linkFrom}"]`).getBoundingClientRect()
    const sourceX = group.dataset.linkEdge === 'end' ? source.right : source.left
    return Math.abs(endpoint.x - target.left) < 1 && Math.abs(endpoint.y - target.top) < 1 && Math.abs(origin.x - sourceX) < 1 && Math.abs(origin.y - source.top) < 1
  })

  await effect.click()
  await expect(reference).toHaveValue('block:announcement')
  await expect(timeline.locator('[data-link-from="announcement"][data-link-edge="end"]')).toHaveCount(1)
  await expect(link()).toHaveAttribute('data-link-from', authored.effectCueId)
  await expect(link()).toHaveAttribute('data-link-edge', 'start')
  await expect(link()).toHaveAttribute('data-link-resolved', 'true')
  await expect(link()).toContainText('−0,5 s')
  await expect.poll(aligned).toBe(true)
  await player.getByRole('button', { name: /^Nombre respecto al inicio de/ }).focus()
  await player.keyboard.press('Enter')
  await expect(timing.getByRole('heading')).toHaveText('Nombre')
  await expect(direction).toHaveValue('before')
  await expect(offset).toHaveValue('0.5')
  await direction.selectOption('after')
  await expect(link()).toContainText('+0,5 s')
  await edge.selectOption('end')
  await expect(link()).toHaveAttribute('data-link-edge', 'end')
  await direction.selectOption('before')
  await offset.fill('0')
  await expect(link()).toContainText('0 s')
  await offset.fill('0.5')
  await edge.selectOption('start')
  await text.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
  const originalPath = await link().locator('path').getAttribute('d')
  const box = await text.boundingBox()
  await player.mouse.move(box.x + Math.min(20, box.width / 3), box.y + box.height / 2)
  await player.mouse.down()
  await player.mouse.move(box.x + Math.min(20, box.width / 3) + 35, box.y + box.height / 2, { steps: 6 })
  await player.mouse.up()
  await expect(reference).toHaveValue(`block:${authored.effectCueId}`)
  await expect.poll(async () => link().locator('path').getAttribute('d')).not.toBe(originalPath)
  await expect.poll(aligned).toBe(true)
  await player.getByRole('button', { name: 'Deshacer', exact: true }).click()
  await expect(offset).toHaveValue('0.5')
  await expect(direction).toHaveValue('before')
  await expect.poll(async () => link().locator('path').getAttribute('d')).toBe(originalPath)
  await player.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('2')
  await expect.poll(aligned).toBe(true)
  await timeline.evaluate((node) => {
    node.scrollLeft = 180
  })
  await expect.poll(aligned).toBe(true)
  await player.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('1')

  await timeline.locator('[data-timeline-cue="announcement"]').click()
  await player.getByRole('region', { name: 'Propiedades del elemento', exact: true }).getByRole('combobox', { name: /^Recurso/ }).selectOption('')
  await expect.poll(() => effect.evaluate(node => !!node.closest('[data-unresolved-cues]'))).toBe(true)
  await expect(timeline.locator(`[data-link-to="${authored.effectCueId}"]`)).toHaveAttribute('data-link-resolved', 'false')
  await expect(timeline.getByText('Sin tiempos de prueba', { exact: true }).first()).toBeVisible()
  await timeline.screenshot({ path: path.join(data, 'scene-links-unresolved.png') })
  await player.getByRole('region', { name: 'Propiedades del elemento', exact: true }).getByRole('combobox', { name: /^Recurso/ }).selectOption(voice.id)
  await text.click()
  await expect(link()).toHaveAttribute('data-link-resolved', 'true')

  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await player.setViewportSize({ width, height })
    if (width === 390) {
      await text.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
      const box = await text.boundingBox()
      const x = Math.min(width - 25, box.x + box.width / 2)
      const y = box.y + box.height / 2
      const before = Number(await offset.inputValue())
      const session = await player.context().newCDPSession(player)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let step = 1; step <= 5; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - step * 5, y }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await session.detach()
      await expect.poll(async () => Number(await offset.inputValue())).toBeGreaterThan(before)
      await expect(reference).toHaveValue(`block:${authored.effectCueId}`)
      await player.getByRole('button', { name: 'Deshacer', exact: true }).click()
      await expect(offset).toHaveValue('0.5')
    }
    await timing.scrollIntoViewIfNeeded()
    await timing.screenshot({ path: path.join(data, `scene-timing-${width}.png`) })
    await timeline.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    await expect.poll(aligned).toBe(true)
    assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const sticky = await timeline.locator('[data-timeline-lane]').first().boundingBox()
    const viewport = await timeline.boundingBox()
    assert.ok(sticky.x >= viewport.x && sticky.x < viewport.x + 32, 'lane names stay visible when scrolling the timeline')
    await timeline.screenshot({ path: path.join(data, `scene-links-${width}.png`) })
  }
  await player.setViewportSize({ width: 1440, height: 1000 })
  await timeline.evaluate((node) => {
    node.scrollLeft = 0
  })
  const save = player.getByRole('button', { name: 'Guardar', exact: true })
  if (await save.isEnabled()) {
    await save.click()
    await expect(player.getByText('Coreografía guardada.', { exact: true })).toBeVisible()
  } else await expect(player.getByRole('group', { name: 'Guardar coreografía' }).getByRole('status')).toHaveText('Guardado')
  console.log('PASS contextual timing, directional dependency arrows, keyboard selection, signed/zero offsets, drag/undo, zoom/scroll and unresolved references')
}
