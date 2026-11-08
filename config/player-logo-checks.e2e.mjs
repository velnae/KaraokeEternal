import { expect } from 'playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

// Sample actual painted GIF frames, not canvas.drawImage's static image representation.
async function paintedColor (image) {
  const png = await image.screenshot()
  const rgb = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'crop=1:1:iw/2:ih/2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png })
  if (rgb[0] > 160 && rgb[1] < 80 && rgb[2] < 80) return 'red'
  if (rgb[2] > 160 && rgb[0] < 80 && rgb[1] < 80) return 'blue'
  if (rgb[1] > 160 && rgb[0] < 80 && rgb[2] < 80) return 'green'
  return [...rgb].join(',')
}

export async function checkPlayerLogo ({ editor, player, call, emit, uiBase, data, realYouTube, initialize = false }) {
  const png = path.join(data, 'logo.png')
  const gif = path.join(data, 'logo.gif')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=lime:s=96x48', '-frames:v', '1', '-threads', '1', png])
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=96x48:r=4:d=0.5', '-f', 'lavfi', '-i', 'color=blue:s=96x48:r=4:d=0.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-threads', '1', '-loop', '0', gif])
  if (initialize) {
    await call('prefs/branding', { name: 'Il Gatto', logoSrc: `data:image/png;base64,${(await fs.readFile(png)).toString('base64')}`, supportUrl: '' }, 'PUT')
    const defaults = (await call('prefs')).playerDisplay
    await call('prefs/player-display', { ...defaults, logo: { ...defaults.logo, enabled: true } }, 'PUT')
    await editor.goto(`${uiBase}account?roomId=1&redirect=${encodeURIComponent('/admin/settings/display')}`)
    await editor.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
    await editor.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
    await editor.getByPlaceholder('contraseña', { exact: true }).fill('branding-test-password')
    await editor.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
    await expect(editor.getByRole('heading', { name: 'Pantalla del reproductor', exact: true })).toBeVisible()
    await player.goto(`${uiBase}player`)
    await player.getByRole('button', { name: 'Reproducir', exact: true }).last().click()
    await expect(player.getByTestId('player-display-overlay')).toBeVisible({ timeout: 30000 })
  }
  const brand = (await call('prefs')).branding
  await editor.goto(`${uiBase}admin/settings/display`)
  const form = editor.getByRole('form', { name: 'Configuración de pantalla' })
  const save = async () => {
    await form.getByRole('button', { name: 'Aplicar cambios', exact: true }).click()
    await expect(form.getByText('Cambios guardados.', { exact: true })).toBeVisible()
  }
  const upload = async (kind, file) => {
    const response = editor.waitForResponse(response => response.url().endsWith(`/api/player-logo-images/${kind}`) && response.request().method() === 'POST')
    await form.getByLabel(`Seleccionar ${kind.toUpperCase()} de pantalla`).setInputFiles(file)
    const result = await response
    assert.equal(result.status(), 201, await result.text())
    await expect(form.getByRole('button', { name: `Cambiar ${kind.toUpperCase()}`, exact: true })).toBeEnabled()
    return result.json()
  }
  await expect(form.getByLabel('Imagen del logo', { exact: true })).toHaveValue('brand')
  await emit('server/PLAYER_REQ_REPLAY', { queueId: 1 })
  await expect(player.getByTestId('player-display-overlay')).toBeVisible({ timeout: 30000 })
  const media = player.locator(realYouTube ? 'iframe' : 'video:not([data-media-role="transition-background"])')
  await media.evaluate((element) => {
    window.logoMedia = element
  })
  const bounds = await media.boundingBox()
  await form.getByLabel('Imagen del logo', { exact: true }).selectOption('custom')
  await form.getByRole('spinbutton', { name: 'Opacidad del logo (%)', exact: true }).fill('100')
  const still = await upload('png', png)
  assert.equal((await call('prefs')).playerDisplay.logo.source, 'brand', 'upload is not activation')
  await save()
  const staticImage = player.getByTestId('display-logo-static')
  const animation = player.getByTestId('display-logo-animation')
  await player.evaluate(() => {
    window.logoAnimationStarts = []
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLImageElement && node.dataset.testid === 'display-logo-animation') window.logoAnimationStarts.push({ src: node.src, at: performance.now() })
      }
    }).observe(document.body, { childList: true, subtree: true })
  })
  await expect(staticImage).toBeVisible()
  await expect.poll(() => paintedColor(staticImage)).toBe('green')
  assert.equal((await call('prefs')).branding.logoSrc, brand.logoSrc)
  await call('prefs/branding', { ...brand, logoSrc: '' }, 'PUT')
  await expect(staticImage).toBeVisible()
  const motion = await upload('gif', gif)
  await expect(form.getByLabel('Presentación del logo', { exact: true })).toHaveValue('alternating')
  await form.getByRole('spinbutton', { name: 'Tiempo estático (s)', exact: true }).fill('5')
  const animatedTime = form.getByRole('spinbutton', { name: 'Tiempo animado (s)', exact: true })
  const animatedSlider = form.getByRole('slider', { name: 'Tiempo animado (s) (deslizador)', exact: true })
  await animatedTime.fill('3.24')
  await animatedTime.press('ArrowUp')
  await expect(animatedTime).toHaveValue('3.25')
  await animatedSlider.focus()
  await animatedSlider.press('ArrowRight')
  await expect(animatedTime).toHaveValue('3.26')
  await animatedSlider.press('ArrowLeft')
  await expect(animatedTime).toHaveValue('3.25')
  let downloads = 0
  player.on('response', (response) => {
    if (response.url().endsWith(`/api/player-logo-images/${motion.id}/image`) && response.status() === 200) downloads++
  })
  await save()
  await expect(animation).toBeVisible({ timeout: 15000 })
  const firstUrl = await animation.getAttribute('src')
  assert.ok(firstUrl.startsWith('blob:'))
  await expect.poll(() => paintedColor(animation), { timeout: 1800, intervals: [50, 100] }).toBe('blue')
  await expect(animation).toHaveCount(0, { timeout: 4000 })
  await expect(staticImage).toBeVisible()
  await expect.poll(() => paintedColor(staticImage)).toBe('green')
  const firstDownloads = downloads
  assert.ok(firstDownloads >= 1)
  await expect.poll(() => animation.isVisible(), { timeout: 9000, intervals: [20] }).toBe(true)
  assert.notEqual(await animation.getAttribute('src'), firstUrl, 'new animated window restarts from a fresh local URL')
  const firstFrame = await paintedColor(animation)
  const frameDelay = await player.evaluate(() => performance.now() - window.logoAnimationStarts.at(-1).at)
  assert.equal(firstFrame, 'red', `the next animation starts at the first frame (sampled after ${Math.round(frameDelay)}ms)`)
  assert.equal(downloads, firstDownloads, 'cycling does not download the GIF again')
  await emit('server/PLAYER_REQ_PAUSE')
  await expect(animation).toHaveCount(0)
  await expect(staticImage).toBeVisible()
  await player.waitForTimeout(8500)
  await expect(animation).toHaveCount(0)
  await emit('server/PLAYER_REQ_PLAY')
  await expect(animation).toBeVisible({ timeout: 9000 })
  await player.emulateMedia({ reducedMotion: 'reduce' })
  await expect(animation).toHaveCount(0)
  await expect(staticImage).toBeVisible()
  await player.waitForTimeout(8500)
  await expect(animation).toHaveCount(0)
  await player.emulateMedia({ reducedMotion: 'no-preference' })
  assert.equal(await media.evaluate(element => element === window.logoMedia), true)
  assert.deepEqual(await media.boundingBox(), bounds)
  await emit('server/PLAYER_REQ_REPLAY', { queueId: 2 })
  await expect(player.getByRole('region', { name: 'Comunicados del local' })).toHaveCount(0)
  await expect(staticImage).toBeVisible({ timeout: 30000 })
  await expect(animation).toBeVisible({ timeout: 12000 })
  await expect.poll(() => paintedColor(animation), { timeout: 1800, intervals: [50, 100] }).toBe('blue')
  await player.screenshot({ path: path.join(data, 'logo-karaoke-animated.png') })
  await editor.reload()
  await expect(form.getByLabel('Imagen del logo', { exact: true })).toHaveValue('custom')
  await expect(form.getByLabel('Presentación del logo', { exact: true })).toHaveValue('alternating')
  await form.getByRole('button', { name: 'Restablecer apariencia' }).click()
  await save()
  let config = (await call('prefs')).playerDisplay
  assert.equal(config.logo.staticImageId, still.id)
  assert.equal(config.logo.animatedImageId, motion.id)
  assert.equal(config.logo.staticSeconds, 5)
  assert.equal(config.logo.animatedSeconds, 3.25)
  await form.getByRole('button', { name: 'Quitar PNG', exact: true }).click()
  await form.getByLabel('Presentación del logo', { exact: true }).selectOption('animated')
  await save()
  await expect(animation).toBeVisible({ timeout: 10000 })
  await emit('server/PLAYER_REQ_PAUSE')
  await expect(animation).toHaveCount(0)
  await expect(staticImage).toHaveAttribute('src', new RegExp(`/api/player-logo-images/${motion.id}/poster$`))
  await expect.poll(() => paintedColor(staticImage)).toBe('red')
  await emit('server/PLAYER_REQ_PLAY')
  const replacement = await upload('gif', gif)
  await player.route(`**/api/player-logo-images/${replacement.id}/image`, route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await save()
  await expect(animation).toHaveCount(0)
  await expect(staticImage).toHaveAttribute('src', new RegExp(`/api/player-logo-images/${replacement.id}/poster$`))
  await expect(staticImage).toBeVisible()
  config = (await call('prefs')).playerDisplay
  const abandoned = await upload('png', png)
  await form.getByRole('button', { name: 'Descartar', exact: true }).click()
  await expect.poll(() => editor.evaluate(async id => (await fetch(`${document.baseURI}api/player-logo-images/${id}/image`)).status, abandoned.id)).toBe(404)
  assert.deepEqual((await call('prefs')).playerDisplay, config)
  for (const width of [1440, 390]) {
    await editor.setViewportSize({ width, height: 1000 })
    await form.locator('fieldset').first().screenshot({ path: path.join(data, `logo-controls-${width}.png`) })
    await form.getByRole('button', { name: 'Subir PNG', exact: true }).locator('..').locator('..').screenshot({ path: path.join(data, `logo-uploads-${width}.png`) })
    await form.getByRole('figure', { name: 'Vista previa de pantalla' }).screenshot({ path: path.join(data, `logo-preview-${width}.png`) })
    assert.ok(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  }
  await call('prefs/branding', brand, 'PUT')
  await form.getByLabel('Imagen del logo', { exact: true }).selectOption('brand')
  await save()
  await expect(player.getByRole('img', { name: 'Logo de Il Gatto' })).toBeVisible()
  await expect(animation).toHaveCount(0)
  console.log('PASS PNG/GIF UI upload, independent identity, real animated frames and restart, no per-cycle download, pause/reduced motion, SING animation, GIF-only poster, failure fallback, reset/persistence/discard and responsive controls')
}
