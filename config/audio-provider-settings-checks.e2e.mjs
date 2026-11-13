import assert from 'node:assert/strict'
import { expect } from 'playwright/test'

export async function checkAudioProviderSettings ({ admin, api, base, calls, data }) {
  const initial = (await (await api.get(`${base}api/birthdays/`)).json()).settings
  const generated = () => calls.filter(call => call.body?.generationConfig?.responseModalities?.includes('AUDIO') || call.url.includes('/v1/text-to-speech/')).length
  const before = generated()
  await admin.goto(`${base}admin/settings/audio-providers?use=birthdays`)
  await expect(admin.getByRole('heading', { name: 'Proveedores de audio', exact: true })).toBeVisible()
  const connections = admin.getByRole('region', { name: 'Conexiones', exact: true })
  await expect(connections.getByRole('heading', { name: 'ElevenLabs' })).toBeVisible()
  await expect(connections.getByRole('heading', { name: 'Gemini' })).toBeVisible()
  const gemini = connections.getByRole('region', { name: 'Gemini', exact: true })
  await gemini.getByRole('combobox').selectOption('birthday-text')
  await gemini.getByRole('button', { name: 'Comprobar conexión', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect(gemini.getByRole('status')).toHaveText(`Modelo verificado: ${initial.textModel}`)
  const voice = admin.getByRole('region', { name: 'Voz de cumpleaños', exact: true })
  await expect(voice.getByRole('combobox', { name: 'Proveedor de voz', exact: true })).toHaveValue(initial.speechProvider)
  await voice.getByText('Más opciones', { exact: true }).click()
  await expect(voice.getByLabel('Modelo de texto Gemini', { exact: true })).toHaveValue(initial.textModel)
  await voice.getByText('Más opciones', { exact: true }).click()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 1000 })
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await admin.locator('main').evaluate(element => element.scrollTo(0, 0))
    await admin.screenshot({ path: `${data}/audio-providers-${width}.png`, fullPage: true })
    await voice.scrollIntoViewIfNeeded()
    await admin.screenshot({ path: `${data}/audio-providers-editor-${width}.png` })
  }
  const nextProvider = initial.speechProvider === 'gemini' ? 'elevenlabs' : 'gemini'
  const nextVoice = nextProvider === 'gemini' ? 'Sulafat' : 'testvoice'
  await voice.getByRole('combobox', { name: 'Proveedor de voz', exact: true }).selectOption(nextProvider)
  await expect(voice.getByRole('combobox', { name: 'Voz predeterminada', exact: true })).toHaveValue('')
  await expect(voice.getByRole('option', { name: nextProvider === 'gemini' ? 'Voz cálida' : 'Voz especial', exact: true }).first()).toBeAttached()
  await voice.getByRole('combobox', { name: 'Voz predeterminada', exact: true }).selectOption(nextVoice)
  const assignments = voice.getByRole('group', { name: 'Reasignar voces de los perfiles', exact: true })
  if (initial.rules.length) {
    await expect(assignments.getByRole('combobox')).toHaveCount(initial.rules.length)
    await voice.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    assert.equal((await (await api.get(`${base}api/birthdays/`)).json()).settings.revision, initial.revision, 'Incomplete reassignment must not save')
    for (const select of await assignments.getByRole('combobox').all()) await select.selectOption(nextVoice)
  }
  await voice.getByRole('button', { name: 'Guardar cambios', exact: true }).focus()
  await admin.keyboard.press('Enter')
  await expect(voice.getByRole('status').filter({ hasText: 'Configuración guardada.' })).toBeVisible()
  const changed = (await (await api.get(`${base}api/birthdays/`)).json()).settings
  assert.equal(changed.speechProvider, nextProvider)
  assert.deepEqual(changed.rules, initial.rules.map(rule => ({ ...rule, voiceId: nextVoice })))
  for (const key of ['introId', 'introIds', 'musicId', 'videoId', 'textModel', 'targetSeconds']) assert.deepEqual(changed[key], initial[key])
  const restored = await api.put(`${base}api/birthdays/settings`, { data: { ...initial, revision: changed.revision } })
  assert.equal(restored.status(), 200)
  await voice.getByRole('textbox', { name: 'Interpretación predeterminada', exact: true }).fill('Clear, warm delivery.')
  await voice.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(voice.getByRole('alert')).toContainText('Los ajustes cambiaron')
  await expect(voice.getByRole('textbox', { name: 'Interpretación predeterminada', exact: true })).toHaveValue('Clear, warm delivery.')
  await voice.getByRole('button', { name: 'Recargar configuración', exact: true }).click()
  await expect(voice.getByRole('combobox', { name: 'Proveedor de voz', exact: true })).toHaveValue(initial.speechProvider)
  await expect(voice.getByRole('textbox', { name: 'Interpretación predeterminada', exact: true })).toHaveValue(initial.speechStyle)
  assert.equal(generated(), before, 'Navigation, checks and saves must not synthesize')
  await voice.getByRole('button', { name: 'Generar prueba de voz', exact: true }).evaluate((element) => {
    element.click()
    element.click()
  })
  const preview = voice.locator('audio[aria-label="Prueba de voz de cumpleaños"]')
  await expect(preview).toBeVisible({ timeout: 20000 })
  await expect.poll(() => preview.evaluate(audio => audio.readyState)).toBeGreaterThan(0)
  assert.equal(await preview.evaluate(audio => audio.paused), true, 'The sample must not autoplay or publish')
  assert.equal(generated(), before + 1, 'A repeated activation must submit only one private generation')
  await admin.goto(`${base}admin/settings/animator?view=greeting-voice`)
  await expect(admin.getByRole('checkbox', { name: 'Preparar voz mientras los pedidos esperan' })).toBeVisible()
  await expect(admin.getByRole('checkbox', { name: 'Generar nuevas voces con Gemini' })).toHaveCount(0)
  await expect(admin.getByRole('link', { name: 'Configurar voz', exact: true })).toHaveAttribute('href', /audio-providers\?use=greetings/)
  await admin.goto(`${base}admin/settings/birthdays?view=settings`)
  await expect(admin.getByRole('region', { name: 'Ajustes de cumpleaños', exact: true })).toBeVisible()
}
