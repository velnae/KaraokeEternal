import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkSceneFullscreen ({ player, uiBase, call, data }) {
  const original = (await call('animation/scenes/')).settings
  const history = await call('animation/history')
  const preview = player.getByRole('region', { name: 'Vista previa de la coreografía', exact: true })
  const enter = () => preview.getByRole('button', { name: 'Pantalla completa', exact: true })
  const exit = () => preview.getByRole('button', { name: 'Salir de pantalla completa', exact: true })
  const clock = () => preview.getByRole('status', { name: 'Tiempo de la vista previa' })
  const position = async () => parseFloat(await clock().textContent())
  const ownsFullscreen = () => player.evaluate(() => document.fullscreenElement === document.querySelector('[aria-label="Vista previa de la coreografía"]'))
  const geometry = () => preview.evaluate((node) => {
    const frame = node.querySelector('[aria-label="Lienzo de la escena"]').getBoundingClientRect()
    const controls = Array.from(node.querySelectorAll('button,summary,input[type="range"]')).filter(item => item.getClientRects().length)
    const box = node.getBoundingClientRect()
    return Math.abs(box.width - innerWidth) < 2 && Math.abs(box.height - innerHeight) < 2
      && Math.abs(frame.width / frame.height - 16 / 9) < 0.02
      && frame.top >= -1 && frame.bottom <= innerHeight + 1
      && controls.every((item) => {
        const rect = item.getBoundingClientRect()
        return rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.right <= innerWidth + 1
      })
  })
  const openEditor = async () => {
    await player.goto(`${uiBase}admin/settings/animator?view=scenes`)
    await player.getByRole('combobox', { name: 'Evento', exact: true }).selectOption('transition')
  }

  await openEditor()
  const sample = (await call('animation/scenes/')).audio.find(item => item.id === 'uploaded-volume-check')
  assert.ok(sample?.durationMs >= 7000, 'a long prepared fixture allows continuity checks without natural completion')
  const timeline = player.getByRole('group', { name: 'Línea de tiempo', exact: true })
  await timeline.getByRole('button', { name: /^Presentación del pedido/ }).click()
  await player.getByRole('region', { name: 'Propiedades del elemento', exact: true }).getByRole('combobox', { name: /^Recurso/ }).selectOption(sample.id)
  const timing = player.getByRole('region', { name: 'Tiempo del bloque', exact: true })
  await timing.getByRole('combobox', { name: 'Referencia', exact: true }).selectOption('start')
  await timing.getByLabel('Desplazamiento (s)', { exact: true }).fill('0')
  await timeline.getByRole('button', { name: 'Ambiente de la sala', exact: true }).click()
  await player.getByRole('checkbox', { name: 'Activo', exact: true }).uncheck()
  await player.evaluate(() => {
    window.fullscreenPreviewStarts = 0
    window.fullscreenPreviewStart = AudioBufferSourceNode.prototype.start
    window.fullscreenPreviewCanvas = document.querySelector('[aria-label="Lienzo de la escena"]')
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.fullscreenPreviewStarts++
      return window.fullscreenPreviewStart.apply(this, args)
    }
  })
  try {
    await preview.getByRole('button', { name: 'Previsualizar', exact: true }).click()
    await expect.poll(position).toBeGreaterThan(0.2)
    const before = await position()
    const starts = await player.evaluate(() => window.fullscreenPreviewStarts)
    const enterIcon = await enter().locator('path').getAttribute('d')
    await expect(enter()).toHaveText('')
    await enter().click()
    await expect.poll(ownsFullscreen).toBe(true)
    await expect(preview).toHaveAttribute('data-preview-fullscreen', 'true')
    await expect(exit()).toHaveText('')
    assert.notEqual(await exit().locator('path').getAttribute('d'), enterIcon, 'fullscreen exit has a distinct contraction icon')
    await expect.poll(geometry).toBe(true)
    assert.ok(await position() >= before, 'fullscreen entry does not reset the private audio clock')
    assert.equal(await player.evaluate(() => window.fullscreenPreviewStarts), starts, 'entry does not restart the audio source')
    assert.equal(await player.evaluate(() => document.querySelector('[aria-label="Lienzo de la escena"]') === window.fullscreenPreviewCanvas), true)
    await exit().click()
    await expect.poll(() => player.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(preview.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
    assert.equal(await player.evaluate(() => window.fullscreenPreviewStarts), starts, 'exit also preserves the running audio source')
    await enter().click()
    await expect.poll(ownsFullscreen).toBe(true)
    await preview.getByRole('button', { name: 'Pausar', exact: true }).click()
    await expect(preview.locator('[data-editable="true"]')).toHaveCount(0)
    const paused = await clock().textContent()
    for (const [width, height] of [[1440, 1000], [844, 390], [390, 844]]) {
      await player.setViewportSize({ width, height })
      await expect.poll(geometry).toBe(true)
      await expect(clock()).toHaveText(paused)
      await player.screenshot({ path: path.join(data, `scene-preview-fullscreen-${width}.png`) })
    }
    await exit().click()
    await expect.poll(() => player.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(enter()).toBeFocused()
    await expect(clock()).toHaveText(paused)
    await enter().press('Enter')
    await expect.poll(ownsFullscreen).toBe(true)
    await expect.poll(geometry).toBe(true)
    await player.keyboard.press('Escape')
    await expect.poll(() => player.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(enter()).toBeFocused()
    await expect(clock()).toHaveText(paused)
    await preview.getByRole('button', { name: 'Continuar', exact: true }).click()
    await expect.poll(position).toBeGreaterThan(parseFloat(paused) + 0.1)
    await preview.getByRole('button', { name: 'Detener', exact: true }).click()
    await expect(clock()).toContainText('0.0 /')
    await player.setViewportSize({ width: 1440, height: 1000 })
    await player.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(player.getByText('Coreografía guardada.', { exact: true })).toBeVisible()
    await enter().click()
    await expect.poll(ownsFullscreen).toBe(true)
    await player.goto(`${uiBase}queue`)
    assert.equal(await player.evaluate(() => document.fullscreenElement === null), true)
  } finally {
    await player.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen()
      if (window.fullscreenPreviewStart) AudioBufferSourceNode.prototype.start = window.fullscreenPreviewStart
    })
    const current = (await call('animation/scenes/')).settings
    await call('animation/scenes/', { ...original, revision: current.revision }, 'PUT')
  }

  await openEditor()
  await preview.evaluate((node) => {
    node.requestFullscreen = () => Promise.reject(new Error('Fixture request rejection'))
  })
  await enter().click()
  await expect(preview.getByRole('alert')).toBeVisible()
  await expect(preview.getByRole('alert')).toContainText('No se pudo cambiar la pantalla completa')
  assert.equal(await player.evaluate(() => document.fullscreenElement === null), true)
  await preview.evaluate((node) => {
    delete node.requestFullscreen
  })
  await player.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
  })
  await enter().click()
  await expect(preview.getByRole('alert')).toBeVisible()
  await expect(preview.getByRole('alert')).toContainText('Este navegador no admite pantalla completa')
  await player.evaluate(() => {
    delete document.fullscreenEnabled
  })
  await enter().click()
  await expect.poll(ownsFullscreen).toBe(true)
  await preview.getByRole('button', { name: 'Previsualizar', exact: true }).click()
  await expect(preview.getByRole('alert')).toBeVisible()
  await expect(preview.getByRole('alert')).toContainText('Seleccione una muestra')
  await player.screenshot({ path: path.join(data, 'scene-preview-fullscreen-error.png') })
  await exit().click()
  assert.deepEqual(await call('animation/history'), history, 'fullscreen preview never reserves public playback')
  await openEditor()
  console.log('PASS private preview fullscreen: native element, audio/clock continuity, pause/resume/stop, button/keyboard/Esc exit, desktop/mobile fit, cleanup and failure feedback')
}
