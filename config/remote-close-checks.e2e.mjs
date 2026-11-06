import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkRemoteClose ({ admin, player, data, db }) {
  const queue = () => db.prepare('SELECT queueId,status FROM queue ORDER BY queueId').all().map(row => ({ ...row }))
  const before = queue()
  const close = () => admin.getByRole('button', { name: 'Cerrar reproductor', exact: true })
  const dialog = () => admin.getByRole('dialog', { name: 'Cerrar reproductor', exact: true })
  const fullscreen = admin.getByRole('button', { name: 'Pantalla completa del reproductor', exact: true })
  assert.equal((await fullscreen.innerText()).trim(), '', 'Fullscreen is a normal icon-only control')
  await expect(fullscreen).toHaveAttribute('title', 'Pantalla completa del reproductor')
  await expect.poll(() => player.evaluate(() => document.fullscreenElement?.id)).toBe('player-fs-container')
  await close().focus()
  await admin.keyboard.press('Enter')
  await expect(dialog().getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused()
  await admin.keyboard.press('Tab')
  await expect(dialog().getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
  for (const width of [1440, 390]) {
    await admin.setViewportSize({ width, height: 900 })
    await admin.screenshot({ path: path.join(data, `remote-close-confirm-${width}.png`) })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await admin.keyboard.press('Escape')
  await expect(dialog()).not.toBeVisible()
  assert.equal(await player.evaluate(() => window.compatibility.video.paused), false, 'Cancel keeps playback running')

  // This tab was created by browser automation, then navigated through login,
  // not by a web link. Exercise Chrome's real refusal, not a stubbed close().
  assert.ok(await player.evaluate(() => history.length > 1 && !window.opener))
  await close().click()
  await dialog().getByRole('button', { name: 'Cerrar y detener', exact: true }).click()
  await expect(player.getByRole('heading', { name: 'Reproductor cerrado desde administración', exact: true })).toBeVisible()
  await expect(admin.getByText('Sin reproductor', { exact: true })).toBeVisible()
  await expect(close()).toBeDisabled()
  await expect.poll(() => player.evaluate(() => ({
    stopped: window.compatibility.video.paused && !window.compatibility.video.isConnected,
    audioClosed: window.compatibility.contexts.every(context => context.state === 'closed'),
    fullscreen: document.fullscreenElement?.id ?? null,
    closeCalls: window.compatibility.closeCalls,
  }))).toEqual({ stopped: true, audioClosed: true, fullscreen: null, closeCalls: 1 })
  const stoppedQueue = before.map(row => row.status === 'PLAYING' ? { ...row, status: 'APPROVED' } : row)
  assert.deepEqual(queue(), stoppedQueue)
  await player.screenshot({ path: path.join(data, 'remote-close-browser-blocked.png') })
  await player.setViewportSize({ width: 390, height: 844 })
  assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await player.screenshot({ path: path.join(data, 'remote-close-browser-blocked-mobile.png') })

  // A normal click on the existing target=_blank link creates a script-closable
  // tab. Reopening must wait for local Play, then closing must really remove it.
  const opened = admin.context().waitForEvent('page')
  await admin.getByRole('link', { name: 'Abrir reproductor', exact: true }).click()
  const reopened = await opened
  try {
    await reopened.waitForLoadState()
    const toolbar = reopened.getByRole('toolbar', { name: 'Controles de reproducción' })
    await expect(toolbar.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()
    assert.deepEqual(queue(), stoppedQueue, 'Reopening does not start or consume a song')
    assert.equal(await reopened.evaluate(() => window.compatibility.video), null)
    await toolbar.getByRole('button', { name: 'Reproducir', exact: true }).click()
    const retry = reopened.getByRole('button', { name: 'Reproducir aquí', exact: true })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=3').get().status).toBe('PLAYING')
    await close().click()
    const closed = reopened.waitForEvent('close')
    await dialog().getByRole('button', { name: 'Cerrar y detener', exact: true }).click()
    await closed
    await expect(admin.getByText('Sin reproductor', { exact: true })).toBeVisible()
    assert.deepEqual(queue(), stoppedQueue)
    console.log('PASS remote close: confirmation/cancel, real browser refusal with silent fallback, native tab closure, retained queue and local Play after reopening')
  } catch (error) {
    if (!reopened.isClosed()) {
      await reopened.screenshot({ path: path.join(data, 'remote-close-reopen-failure.png') })
      console.error('Reopened player:', reopened.url(), await reopened.locator('body').innerText())
    }
    throw error
  } finally {
    if (!reopened.isClosed()) await reopened.close()
  }
}
