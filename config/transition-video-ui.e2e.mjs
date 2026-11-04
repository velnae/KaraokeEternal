import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'

async function signIn (page, uiBase, roomId) {
  await page.goto(`${uiBase}account?roomId=${roomId}&redirect=${encodeURIComponent('/admin/settings/animator?view=background')}`)
  await page.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await page.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await page.getByPlaceholder('contraseña', { exact: true }).fill('video-test-password')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
}

export async function runTransitionVideoUiChecks ({ page, uiBase, source, data, background, json, fetchRoute, httpsUi, readAmbience }) {
  const settingsUrl = /\/api\/animation\/background\/?$/
  const uploadUrl = /\/api\/animation\/background\/upload$/
  await signIn(page, uiBase, 1)
  const panel = page.getByRole('region', { name: 'Fondo de transición', exact: true })
  const video = panel.locator('video')
  const opacity = panel.getByRole('slider', { name: 'Oscurecimiento' })
  const select = panel.getByLabel('Video para la vista previa')
  await expect(panel.getByText('Vista previa local', { exact: true })).toBeVisible()
  await expect(panel.getByText('Video disponible', { exact: true })).toBeVisible()
  await expect(panel.getByRole('switch')).toHaveCount(0)
  assert.equal(await video.evaluate(element => element.paused), true)
  const ambience = page.getByRole('region', { name: 'Sonido de pausa del reproductor', exact: true })
  const ambienceVolume = ambience.getByRole('slider', { name: 'Volumen de ambiente', exact: true })
  await expect(ambience.getByRole('heading', { name: 'Sonido de pausa', exact: true })).toBeVisible()
  if (httpsUi) {
    await expect(ambienceVolume).toBeDisabled()
    await expect(ambience.getByRole('status')).toContainText('Conectando con la sala')
  } else {
    await expect(ambienceVolume).toBeEnabled()
    const version = readAmbience().controlVersion
    await ambienceVolume.press('End')
    await expect.poll(() => readAmbience().ambienceVolume).toBe(1)
    await expect(ambienceVolume).toBeEnabled()
    await ambienceVolume.press('Tab')
    await page.reload()
    await expect(ambienceVolume).toBeEnabled()
    await expect(ambienceVolume).toHaveValue('100')
    assert.equal(readAmbience().controlVersion, version + 1, 'blur must not send the same volume again')
    await ambienceVolume.press('Home')
    await expect(ambienceVolume).toBeEnabled()
    for (let step = 0; step < 4; step++) {
      await ambienceVolume.press('ArrowRight')
      await expect(ambienceVolume).toBeEnabled()
    }
    await expect.poll(() => readAmbience().ambienceVolume).toBe(0.2)
    const toggle = ambience.getByRole('checkbox', { name: 'Sonido de pausa', exact: true })
    await toggle.click()
    await expect.poll(() => readAmbience().ambienceEnabled).toBe(true)
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect.poll(() => readAmbience().ambienceEnabled).toBe(false)
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await ambience.scrollIntoViewIfNeeded()
    await ambience.screenshot({ path: path.join(data, `ambience-settings-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 1100 })

  let holdPreparation = true
  let uploadedId
  await page.route(settingsUrl, async (route) => {
    const response = await fetchRoute(route)
    const result = await response.json()
    if (holdPreparation && result.candidate) {
      result.candidate = { ...result.candidate, state: 'preparing', videoUrl: null, posterUrl: null }
      result.capability.busy = true
    }
    await route.fulfill({ response, json: result })
  })
  const cdp = httpsUi ? null : await page.context().newCDPSession(page)
  if (cdp) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 64 * 1024 })
  }
  const received = page.waitForResponse(response => uploadUrl.test(response.url()) && response.request().method() === 'POST')
  await panel.getByLabel('Archivo de video').setInputFiles(source)
  if (!httpsUi) await expect(panel.getByRole('progressbar', { name: 'Progreso de carga' })).toBeVisible()
  const response = await received
  assert.equal(response.status(), 202, await response.text())
  uploadedId = (await response.json()).id
  if (cdp) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await cdp.detach()
  }
  await expect(panel.getByText('Preparando video', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Guardar fondo', exact: true })).toBeDisabled()
  await opacity.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await expect(opacity).toHaveValue('84')
  holdPreparation = false
  await expect(panel.getByText('Video disponible', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(opacity).toHaveValue('84')
  await expect(select).toHaveValue(uploadedId)
  await page.unroute(settingsUrl)

  let releaseMedia
  const mediaGate = new Promise((resolve) => {
    releaseMedia = resolve
  })
  const mediaUrl = new RegExp(`/api/animation/background/videos/${uploadedId}/video$`)
  await page.route(mediaUrl, async (route) => {
    await mediaGate
    await route.fulfill({ response: await fetchRoute(route) })
  })
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect(panel.getByText(/Cargando el video/)).toBeVisible()
  releaseMedia()
  await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)
  await page.unroute(mediaUrl)
  const sameVideo = await video.elementHandle()
  await video.evaluate((element) => {
    window.transitionPreview = element
    window.transitionLoads = 0
    element.addEventListener('loadstart', () => window.transitionLoads++)
  })
  for (const label of ['Saludo', 'Anuncio', 'Karaoke']) {
    await panel.getByRole('button', { name: label, exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(panel.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    assert.equal(await video.evaluate(element => element === window.transitionPreview), true)
  }
  await page.waitForResponse(response => settingsUrl.test(response.url()) && response.request().method() === 'GET')
  await expect(opacity).toHaveValue('84')
  assert.equal(await page.evaluate(() => window.transitionLoads), 0)

  // Disappearance from the latest-candidate list is not itself retirement: an
  // older asset may still be pinned. Only its status endpoint can confirm loss.
  await page.route(settingsUrl, async (route) => {
    const response = await fetchRoute(route)
    await route.fulfill({ response, json: { ...await response.json(), candidate: null } })
  })
  const resourceUrl = new RegExp(`/api/animation/background/videos/${uploadedId}$`)
  await page.waitForResponse(response => resourceUrl.test(response.url()))
  await expect(panel.getByRole('button', { name: 'Guardar fondo', exact: true })).toBeEnabled()
  await page.route(resourceUrl, route => route.fulfill({ status: 404, body: 'No disponible' }))
  await expect(panel.getByText('El video ya no está disponible', { exact: true })).toBeVisible()
  await expect(select).toHaveValue(uploadedId)
  await expect(opacity).toHaveValue('84')
  await expect(panel.getByRole('button', { name: 'Guardar fondo', exact: true })).toBeDisabled()
  await page.unroute(resourceUrl)
  await page.unroute(settingsUrl)
  await expect(panel.getByText('Video disponible', { exact: true })).toBeVisible()

  // The server commits, but the browser loses the PUT response. GET reconciliation
  // must confirm it without clearing the draft or issuing another PUT.
  let saves = 0
  await page.route(settingsUrl, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    saves++
    await fetchRoute(route)
    await route.abort('failed')
  })
  await panel.getByRole('button', { name: 'Guardar fondo', exact: true }).click()
  await expect(panel.getByText('Fondo guardado.', { exact: true })).toBeVisible()
  assert.equal(saves, 1)
  await page.unroute(settingsUrl)
  await page.reload()
  await expect(select).toHaveValue(uploadedId)
  await expect(opacity).toHaveValue('84')
  assert.equal(await video.evaluate(element => element.paused), true)

  // A remote edit must show a conflict without moving the local slider.
  await opacity.focus()
  await page.keyboard.press('ArrowLeft')
  const current = await json(await background())
  await json(await background('', { method: 'PUT', data: { ...current.settings, dimOpacity: 0.55 } }))
  await expect(panel.getByText(/El fondo cambió en otra sesión/)).toBeVisible()
  await expect(opacity).toHaveValue('83')
  await panel.getByRole('button', { name: 'Recargar configuración', exact: true }).click()
  await expect(opacity).toHaveValue('55')

  // Recover a received upload by its request ID when its response is lost.
  await page.evaluate(() => {
    const originalSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData && body.has('file')) {
        XMLHttpRequest.prototype.send = originalSend
        // Simulate losing the completion notification after the server receives
        // the real file. Do not serialize intercepted disk-backed File bodies.
        this.onload = () => this.onerror?.(new ProgressEvent('error'))
      }
      return originalSend.call(this, body)
    }
  })
  const recovered = page.waitForResponse(response => uploadUrl.test(response.url()) && !response.request().headers()['content-type'])
  await panel.getByLabel('Archivo de video').setInputFiles(source)
  const recoveredId = (await (await recovered).json()).id
  await expect(panel.getByText('Video disponible', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => select.inputValue()).toBe(recoveredId)
  assert.equal((await json(await background())).candidate.id, recoveredId)
  await select.selectOption(uploadedId)

  // Decode failure keeps HTML text/poster visible and offers an explicit retry.
  await page.route(mediaUrl, route => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'invalid' }))
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect(panel.getByText(/No se pudo reproducir el video/)).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Tu momento de brillar' })).toBeVisible()
  await expect.poll(() => panel.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await page.unroute(mediaUrl)
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect.poll(() => video.evaluate(element => !element.paused && element.currentTime > 0)).toBe(true)

  await panel.getByRole('button', { name: 'Pausar vista previa', exact: true }).click()
  await video.evaluate((element) => {
    element.play = () => Promise.reject(new DOMException('Blocked fixture', 'NotAllowedError'))
  })
  for (let retry = 0; retry < 2; retry++) {
    await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
    await expect(panel.getByText(/El navegador detuvo la reproducción/)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reproducir vista previa', exact: true })).toBeVisible()
  }
  await video.evaluate(element => delete element.play)
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect.poll(() => video.evaluate(element => !element.paused && element.parentElement.dataset.playback === 'playing')).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => video.evaluate(element => element.paused)).toBe(true)
  await expect(panel.getByText(/Movimiento reducido/)).toBeVisible()
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  await expect.poll(() => video.evaluate(element => !element.paused)).toBe(true)
  const abandoned = await video.elementHandle()
  await page.getByRole('link', { name: 'Control', exact: true }).click()
  await expect.poll(() => abandoned.evaluate(element => element.paused && !element.hasAttribute('src'))).toBe(true)
  await page.getByRole('link', { name: 'Fondo', exact: true }).click()
  await expect(panel.getByText('Video disponible', { exact: true })).toBeVisible()
  assert.equal(await video.evaluate(element => element.paused), true)
  await sameVideo.dispose()
  await abandoned.dispose()

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await panel.getByRole('button', { name: width === 390 ? 'Saludo' : 'Anuncio', exact: true }).click()
    await page.locator('main').evaluate(element => element.scrollTo(0, 0))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: path.join(data, `background-${width}.png`), fullPage: true })
    await panel.getByRole('button', { name: 'Guardar fondo', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(data, `background-controls-${width}.png`), fullPage: true })
  }
  // A real room change must not carry the first room's preview or draft into the next.
  await panel.getByRole('button', { name: 'Reproducir vista previa', exact: true }).click()
  const oldRoomVideo = await video.elementHandle()
  await page.getByRole('button', { name: /Abrir menú/ }).click()
  await page.getByRole('link', { name: 'Mi cuenta', exact: true }).click()
  await expect.poll(() => oldRoomVideo.evaluate(element => element.paused && !element.hasAttribute('src'))).toBe(true)
  await oldRoomVideo.dispose()
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await page.waitForURL(/\/account\?/)
  await signIn(page, uiBase, 2)
  await expect(panel.getByRole('button', { name: 'Subir video', exact: true })).toBeEnabled()
  await expect(select).toHaveValue('')
  await expect(opacity).toHaveValue('55')
  await expect(panel.getByRole('button', { name: 'Reproducir vista previa', exact: true })).toBeDisabled()
  return uploadedId
}
