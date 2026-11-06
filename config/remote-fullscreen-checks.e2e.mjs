import { expect } from 'playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkRemoteFullscreen ({ player, uiBase, data, db }) {
  const context = player.context()
  const playerCdp = await context.newCDPSession(player)
  const { targetInfo } = await playerCdp.send('Target.getTargetInfo')
  const { windowId: playerWindow } = await playerCdp.send('Browser.getWindowForTarget')
  const browserCdp = await context.browser().newBrowserCDPSession()
  const origin = new URL(uiBase).origin
  const read = async (expression) => {
    // Do not create activation while observing the remote player's state.
    const reply = await playerCdp.send('Runtime.evaluate', { expression, userGesture: false, returnByValue: true, awaitPromise: true })
    assert.ok(!reply.exceptionDetails, reply.exceptionDetails?.text)
    return reply.result.value
  }
  let admin
  try {
    const opened = context.waitForEvent('page')
    await browserCdp.send('Target.createTarget', { url: `${uiBase}queue`, newWindow: true, browserContextId: targetInfo.browserContextId })
    admin = await opened
    await admin.waitForLoadState()
    const adminCdp = await context.newCDPSession(admin)
    const { windowId: adminWindow } = await adminCdp.send('Browser.getWindowForTarget')
    assert.notEqual(adminWindow, playerWindow, 'Admin and player must be different browser windows')
    const button = admin.getByRole('button', { name: 'Pantalla completa del reproductor (beta)', exact: true })
    await expect(button).toBeEnabled()
    await browserCdp.send('Browser.setPermission', {
      permission: { name: 'fullscreen', allowWithoutGesture: true }, setting: 'denied', origin, browserContextId: targetInfo.browserContextId,
    })
    const until = Date.now() + 10000
    while (await read('navigator.userActivation.isActive')) {
      assert.ok(Date.now() < until, 'The initial player gesture must expire')
      await delay(100)
    }
    await read('window.remoteFullscreenVideo = window.compatibility.video; true')
    const before = await read('({time:window.compatibility.video.currentTime,requests:window.compatibility.fullscreenRequests.length})')
    await button.click()
    await expect(admin.getByText('Chrome del reproductor requiere autorizar la pantalla completa automática. Abre «Ver pasos».', { exact: true })).toBeVisible()
    assert.equal(await read('document.fullscreenElement'), null)
    assert.equal(await read('window.compatibility.fullscreenRequests.length'), before.requests, 'Permission denial must not attempt native fullscreen')
    assert.equal(await read('window.compatibility.video.paused'), false)

    await admin.getByRole('button', { name: 'Ver pasos para fullscreen remoto' }).focus()
    await admin.keyboard.press('Enter')
    const help = admin.getByRole('dialog', { name: 'Pantalla completa remota (beta)', exact: true })
    await expect(help).toBeVisible()
    await expect(help.getByText(origin, { exact: true })).toBeVisible()
    await help.getByText('Windows · Google Chrome', { exact: true }).click()
    for (const width of [1440, 390]) {
      await admin.setViewportSize({ width, height: 900 })
      await expect(help).toBeVisible()
      await admin.screenshot({ path: path.join(data, `remote-fullscreen-help-${width}.png`) })
      assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    }
    await admin.keyboard.press('Escape')
    await expect(help).not.toBeVisible()

    await browserCdp.send('Browser.setPermission', {
      permission: { name: 'fullscreen', allowWithoutGesture: true }, setting: 'granted', origin, browserContextId: targetInfo.browserContextId,
    })
    assert.equal(await read('navigator.userActivation.isActive'), false)
    await button.click()
    await expect(admin.getByText('El reproductor confirmó la pantalla completa.', { exact: true })).toBeVisible()
    const confirmed = await read('({target:document.fullscreenElement?.id,request:window.compatibility.fullscreenRequests.at(-1),sameMedia:window.compatibility.video===window.remoteFullscreenVideo,time:window.compatibility.video.currentTime,paused:window.compatibility.video.paused})')
    assert.equal(confirmed.target, 'player-fs-container')
    assert.equal(confirmed.request.active, false, 'Remote fullscreen must succeed without a fresh player gesture')
    assert.equal(confirmed.sameMedia, true)
    assert.equal(confirmed.paused, false)
    assert.ok(confirmed.time >= before.time, 'Fullscreen must not restart the song')
    assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=3').get().status, 'PLAYING')
    assert.equal(await admin.evaluate(() => document.fullscreenElement), null, 'Admin must stay out of fullscreen')
    await admin.screenshot({ path: path.join(data, 'remote-fullscreen-confirmed.png') })
    await button.click()
    await expect(admin.getByText('El reproductor confirmó la pantalla completa.', { exact: true })).toBeVisible()
    assert.equal(await read('window.compatibility.fullscreenRequests.length'), before.requests + 1, 'An already-fullscreen player is idempotent')
    await read('document.exitFullscreen()')
    console.log('PASS remote fullscreen: separate admin/player windows, denied/granted permission, no player gesture, unchanged media, keyboard help and responsive UI')
  } finally {
    await admin?.close()
    await browserCdp.send('Browser.resetPermissions', { browserContextId: targetInfo.browserContextId })
    await playerCdp.detach()
    await browserCdp.detach()
  }
}
