import { expect } from 'playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import { checkRemoteClose } from './remote-close-checks.e2e.mjs'

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
    const button = admin.getByRole('button', { name: 'Pantalla completa del reproductor', exact: true })
    const controls = button.locator('..').locator('..')
    const feedback = controls.getByRole('status')
    const setupHelp = admin.getByRole('button', { name: 'Ver pasos para fullscreen remoto' })
    await expect(button).toBeEnabled()
    await expect(controls.getByRole('button')).toHaveCount(2)
    await expect(setupHelp).toHaveCount(0)
    await expect(feedback).toHaveCSS('clip-path', 'inset(50%)')
    for (const width of [1440, 390]) {
      await admin.setViewportSize({ width, height: 900 })
      assert.equal(Math.round((await controls.boundingBox()).height), 44)
      await admin.screenshot({ path: path.join(data, `remote-controls-icons-${width}.png`) })
    }
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
    const help = admin.getByRole('dialog', { name: 'Pantalla completa remota', exact: true })
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
    await read(`window.originalRequestFullscreen = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function () { return Promise.reject(new Error('Fixture request failure')) }; true`)
    await button.click()
    await expect(feedback).toHaveText('El reproductor no pudo completar la solicitud. Revisa su navegador y vuelve a intentar.')
    await expect(setupHelp).toHaveCount(0)
    await read('Element.prototype.requestFullscreen = window.originalRequestFullscreen; true')
    // Hold one permission query to inspect the real pending UI deterministically.
    await read(`window.originalPermissionQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = descriptor => {
        navigator.permissions.query = window.originalPermissionQuery;
        return new Promise(resolve => { window.releaseFullscreenPermission = () => window.originalPermissionQuery(descriptor).then(resolve) });
      }; true`)
    assert.equal(await read('navigator.userActivation.isActive'), false)
    await button.click()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toBeDisabled()
    await expect(setupHelp).toHaveCount(0)
    await expect(feedback).toHaveText('Esperando confirmación del reproductor…')
    await expect(feedback).toHaveCSS('clip-path', 'inset(50%)')
    await read('window.releaseFullscreenPermission()')
    await expect(feedback).toHaveAttribute('data-result', 'entered')
    await expect(button).toHaveAttribute('aria-busy', 'false')
    await expect(feedback).toHaveCSS('clip-path', 'inset(50%)')
    await expect(setupHelp).toHaveCount(0)
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
    await expect(feedback).toHaveAttribute('data-result', 'entered')
    assert.equal(await read('window.compatibility.fullscreenRequests.length'), before.requests + 1, 'An already-fullscreen player is idempotent')
    console.log('PASS remote fullscreen: separate admin/player windows, denied/granted permission, no player gesture, unchanged media, keyboard help and responsive UI')
    await checkRemoteClose({ admin, player, data, db })
  } finally {
    await admin?.close()
    await browserCdp.send('Browser.resetPermissions', { browserContextId: targetInfo.browserContextId })
    await playerCdp.detach()
    await browserCdp.detach()
  }
}
