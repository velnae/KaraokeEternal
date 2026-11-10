import { build } from 'esbuild'
import { chromium, expect } from 'playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Render the real presentation and CSS in an isolated HTTPS fixture, without
// connecting a player or writing anything to the shared development room.
const root = path.resolve(import.meta.dirname, '..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-title-'))
const bundle = await build({
  stdin: { contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import Presentation from './src/routes/Player/components/Animation/PlayerTransitionPresentation'
    const root = createRoot(document.getElementById('root'))
    window.present = (patch = {}) => {
      const track = { queueId: 1, title: 'Rayando el sol', origin: 'PARTICIPANT', requestIntent: 'LISTEN',
        source: 'YOUTUBE', userDisplayName: 'Ana', artistOrChannel: '', tableLabelSnapshot: 'Mesa 07', ...patch }
      root.render(<React.StrictMode><Presentation incoming={track} following={{ ...track, queueId: 2 }}
        venueName='Il Gatto' greeting={patch.greeting ?? null} onGreetingMounted={() => {}} /></React.StrictMode>)
    }
    window.present()
  `, resolveDir: root, loader: 'tsx' },
  tsconfig: path.join(root, 'config/tsconfig.client.json'),
  bundle: true, write: false, outfile: 'fixture.js', loader: { '.css': 'local-css' },
})
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Confirm the tunnel serves the application before installing the fixture.
  await page.goto('https://dev-karaoke.puyu.pe/')
  await expect(page).toHaveTitle('Karaoke Eternal')
  await page.route('**/__transition-title-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html lang="es"><head><style>
      html, body { margin: 0; background: #030509; font-family: Arial, sans-serif; }
      #root { width: 100vw; height: 100vh; container-type: size; }
      ${css}
    </style></head><body><div id="root"></div></body></html>` }))
  await page.goto('https://dev-karaoke.puyu.pe/__transition-title-fixture')
  await page.addScriptTag({ content: js })
  const titles = page.locator('[data-transition-title="true"]')
  const present = async (patch) => {
    await page.evaluate(patch => window.present(patch), patch)
    await expect(page.getByTestId('transition-incoming')).toContainText(patch.title)
  }
  const measurements = () => titles.evaluateAll(nodes => nodes.map((node) => {
    const style = getComputedStyle(node)
    const size = parseFloat(style.fontSize)
    const floor = parseFloat(style.getPropertyValue('--title-floor'))
    const lines = Number(style.webkitLineClamp)
    const clipped = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
    const inline = node.style.fontSize
    node.style.removeProperty('font-size')
    const base = parseFloat(getComputedStyle(node).fontSize)
    const overflow = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
    node.style.fontSize = inline
    return { size, base, overflow, minimum: Math.min(base, Math.max(floor, base * 0.7)), lines, clipped }
  }))
  await page.evaluate(() => window.present({ title: '🎤  Ｍａｎá — Rayando el Sol 👩🏽‍🎤🇵🇪1️⃣' }))
  await expect(titles.first()).toHaveText('Maná — Rayando el Sol')
  await expect(titles.last()).toHaveText('Maná — Rayando el Sol')
  const long = 'Una canción con un título especialmente largo para compartir con todos los amigos y celebrar juntos otra noche de música y karaoke '.repeat(3).trim()
  await present({ title: long, requestIntent: 'LISTEN' })
  await expect.poll(async () => (await measurements())[0].size < (await measurements())[0].base).toBe(true)
  await present({ title: long, requestIntent: 'SING' })
  assert.equal(await page.getByRole('heading').evaluate(node => node.style.fontSize), '', 'a reused song heading must not shrink the singer name')
  for (const [width, height] of [[1920, 1080], [390, 844], [844, 480]]) {
    await page.setViewportSize({ width, height })
    for (const requestIntent of ['LISTEN', 'SING']) {
      await present({ title: long, requestIntent })
      await expect.poll(async () => (await measurements()).every(({ size, minimum, overflow, clipped }) => overflow && clipped && Math.abs(size - minimum) < 0.01)).toBe(true)
      assert.deepEqual((await measurements()).map(item => item.lines), [requestIntent === 'LISTEN' ? 3 : 2, 2])
      if (requestIntent === 'SING') {
        await expect(page.getByRole('heading')).toHaveText('Ana')
        assert.equal(await page.getByRole('heading').evaluate(node => node.style.fontSize), '')
      }
      await page.screenshot({ path: path.join(output, `${requestIntent}-${width}.png`) })
      await present({ title: 'Sol', requestIntent })
      await expect.poll(async () => (await measurements()).every(({ size, base }) => size === base)).toBe(true)
    }
  }
  // A resize must reconsider the same title, even without new props.
  await page.setViewportSize({ width: 390, height: 844 })
  await present({ title: 'W'.repeat(36), requestIntent: 'LISTEN' })
  await expect.poll(async () => {
    const { size, base, minimum, clipped } = (await measurements())[0]
    return size < base && size > minimum && !clipped
  }).toBe(true)
  assert.ok(await titles.first().evaluate((node) => {
    const inline = node.style.fontSize
    node.style.fontSize = `${parseFloat(getComputedStyle(node).fontSize) + 0.5}px`
    const overflows = node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
    node.style.fontSize = inline
    return overflows
  }), 'adaptive fitting must choose the largest size within half a pixel')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(async () => (await measurements())[0].size / (await measurements())[0].base).toBe(1)
  // A third line should reveal more text before any font reduction.
  await present({ title: 'W'.repeat(32), requestIntent: 'LISTEN' })
  const expanded = (await measurements())[0]
  assert.equal(expanded.lines, 3)
  assert.equal(expanded.size, expanded.base)
  assert.equal(expanded.clipped, false)
  assert.ok(await titles.first().evaluate(node => node.clientHeight > parseFloat(getComputedStyle(node).lineHeight) * 2 + 1))
  await page.setViewportSize({ width: 844, height: 240 })
  await present({ title: long, requestIntent: 'LISTEN' })
  await expect.poll(async () => (await measurements())[0].lines).toBe(2)
  assert.ok(await page.getByTestId('transition-incoming').evaluate((node) => {
    const header = node.getBoundingClientRect()
    const foreground = node.parentElement.getBoundingClientRect()
    return header.top >= foreground.top - 1 && header.bottom <= foreground.bottom + 1
  }), 'a third title line must not displace the track context in a short viewport')
  // Greetings reserve space and retain the compact two-line track context.
  await page.setViewportSize({ width: 844, height: 360 })
  await present({ title: long, requestIntent: 'LISTEN', greeting: { greetingId: 7, message: '¡Feliz cumpleaños!', sender: 'Ana' } })
  await expect(page.getByTestId('greeting-overlay')).toBeVisible()
  assert.equal((await measurements())[0].lines, 2)
  assert.ok(await page.getByTestId('transition-presentation').evaluate((root) => {
    const header = root.querySelector('header').getBoundingClientRect()
    const greeting = root.querySelector('[data-testid="greeting-overlay"]').getBoundingClientRect()
    const next = root.querySelector('aside').getBoundingClientRect()
    return header.top >= -1 && header.bottom <= greeting.top && greeting.bottom <= next.top
  }), 'track context must not displace the greeting or following song')
  await page.screenshot({ path: path.join(output, 'greeting-landscape.png') })
  assert.deepEqual(errors, [])
  console.log(`PASS HTTPS isolated presentation: normalization, adaptive maximum-size fit, readable floor, three/two lines, greetings, singer unchanged, short-title reset, resize, StrictMode; screenshots: ${output}`)
} finally {
  await browser.close()
}
