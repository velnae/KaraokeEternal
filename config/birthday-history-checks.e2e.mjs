import assert from 'node:assert/strict'
import { expect, request } from 'playwright/test'

export async function checkBirthdayHistory ({ admin, api, base, uiBase, db, birthday, data, calls }) {
  const providerRequests = calls.length
  const response = await api.get(`${base}api/birthdays/history`)
  assert.equal(response.status(), 200)
  const overview = await response.json()
  assert.equal(overview.total, 2)
  const original = db.prepare('SELECT * FROM birthdays WHERE id=?').get(birthday.id)
  for (let i = 0; i < 24; i++) {
    db.prepare(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,preparation,playback,script,greetingId,durationMs,personalizationJSON)
      VALUES(?,1,?,?,'unspecified',1990,2026,?,?,?,'ready','completed',?,?,?,?)`).run(
      `history-${i}`, `history-request-${i}`, `Evento de archivo ${i}`, original.voiceId, original.settingsJSON, original.createdAt - i - 1,
      original.script, original.greetingId, original.durationMs, original.personalizationJSON,
    )
  }
  db.prepare('UPDATE birthdays SET greetingId=NULL WHERE id=\'history-0\'').run()
  db.exec('INSERT INTO rooms(roomId,name,status,data) VALUES(2,\'Otra sala\',\'closed\',\'{}\')')
  db.prepare(`INSERT INTO birthdays(id,roomId,requestId,name,sex,birthYear,celebrationYear,voiceId,settingsJSON,createdAt,preparation,playback)
    VALUES('private-other-room',2,'private-other-room','Otra sala','unspecified',1990,2026,'voice',?,?,'ready','completed')`).run(original.settingsJSON, original.createdAt)
  assert.equal((await api.get(`${base}api/birthdays/history/private-other-room`)).status(), 404)
  const anonymous = await request.newContext()
  assert.equal((await anonymous.get(`${base}api/birthdays/history`)).status(), 403)
  assert.equal((await anonymous.get(`${base}api/birthdays/history/${birthday.id}`)).status(), 403)
  await anonymous.dispose()
  assert.equal((await api.put(`${base}api/birthdays/history/${birthday.id}/review`, { data: {} })).status(), 404)

  await admin.goto(`${uiBase}admin/settings/birthdays?view=history`)
  const history = admin.getByRole('region', { name: 'Historial de cumpleaños', exact: true })
  await expect(history.getByText('Página 1 de 2', { exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(history.getByText('Página 2 de 2', { exact: true })).toBeVisible()
  await history.getByRole('searchbox', { name: 'Buscar por nombre', exact: true }).fill('María')
  await history.getByRole('button', { name: 'Buscar', exact: true }).click()
  const opener = history.getByRole('button', { name: 'Ver cumpleaños de María', exact: true })
  await opener.focus()
  await admin.keyboard.press('Enter')
  const detail = admin.getByRole('dialog', { name: 'Cumpleaños de María', exact: true })
  await expect(detail.getByRole('heading', { name: 'Saludo', exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Tu revisión', exact: true })).toHaveCount(0)
  await expect(detail.getByRole('textbox')).toHaveCount(0)
  await expect(history.getByRole('combobox', { name: 'Revisión', exact: true })).toHaveCount(0)
  await expect(detail.getByRole('region', { name: 'Saludo generado' }).locator('audio')).toHaveCount(1)
  await detail.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => detail.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0)
  assert.equal(db.prepare('SELECT revision FROM birthdays WHERE id=?').get(birthday.id).revision, original.revision)
  const sound = await detail.locator('audio').elementHandle()
  await admin.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  assert.equal(await sound.evaluate(element => element.paused), true, 'Closing history must stop local audio')
  assert.ok(new URL(admin.url()).searchParams.get('search') === 'María')
  await history.getByRole('combobox', { name: 'Resultado', exact: true }).selectOption('completed')
  await history.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(history.getByRole('button', { name: 'Ver cumpleaños de María', exact: true })).toBeVisible()
  await admin.reload()
  await history.getByRole('button', { name: 'Ver cumpleaños de María', exact: true }).click()
  await expect(detail.getByRole('heading', { name: 'Personalización', exact: true })).toBeVisible()
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    await expect(detail.getByRole('heading', { name: 'Saludo', exact: true })).toBeVisible()
    assert.ok(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 2))
    await admin.screenshot({ path: `${data}/history-detail-${width}.png` })
  }
  await admin.keyboard.press('Escape')
  for (const width of [390, 1440]) {
    await admin.setViewportSize({ width, height: 900 })
    await admin.getByRole('heading', { name: 'Cumpleaños', exact: true }).scrollIntoViewIfNeeded()
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await admin.screenshot({ path: `${data}/history-list-${width}.png` })
  }
  await history.getByRole('searchbox', { name: 'Buscar por nombre', exact: true }).fill('No existe esta persona')
  await history.getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(history.getByRole('heading', { name: 'No se encontraron cumpleaños', exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
  await history.getByRole('searchbox', { name: 'Buscar por nombre', exact: true }).fill('Evento de archivo 0')
  await history.getByRole('button', { name: 'Buscar', exact: true }).click()
  await history.getByRole('button', { name: 'Ver cumpleaños de Evento de archivo 0', exact: true }).click()
  await expect(admin.getByRole('dialog').getByText('No hay audio preparado para esta versión.', { exact: true })).toBeVisible()
  await expect(admin.getByRole('dialog').locator('audio')).toHaveCount(0)
  await admin.keyboard.press('Escape')
  assert.equal(calls.length, providerRequests, 'History and playback must not call generation providers')
}
