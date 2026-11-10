import { expect } from 'playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function checkSingingHistory ({ page, uiBase, data, db, snapshot, first, fallback }) {
  const original = db.prepare('SELECT p.* FROM karaokeCallParts p JOIN karaokeCallRequests r ON r.resultId=p.id WHERE r.queueId=?').get(first)
  const interventionCount = db.prepare('SELECT count(*) n FROM animationInterventions').get().n
  const generationCount = db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation!='compose'`).get().n
  const fallbackState = (await snapshot()).automation.requests.find(item => item.queueId === fallback)
  assert.equal(fallbackState.playback, 'played')
  assert.equal(fallbackState.usedFallback, true)
  assert.ok(fallbackState.playedResult.text.includes('próximo cantante'))
  db.prepare('UPDATE karaokeCallParts SET retired=1 WHERE id=?').run(original.id)
  for (const file of [original.master, original.filename]) fs.rmSync(path.join(data, 'animation/calls', file))
  await page.goto(uiBase + 'admin/settings/animator?view=calls')
  await page.getByText(/Pedidos de karaoke \(/).click()
  const history = page.getByRole('listitem').filter({ has: page.getByText('Rayando el sol', { exact: true }) })
  await expect(history.getByText('Anunciado', { exact: true })).toBeVisible()
  await history.getByRole('button', { name: 'Recuperar audio', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(history.getByRole('button', { name: 'Escuchar llamado de Ana', exact: true })).toBeVisible({ timeout: 15000 })
  await history.getByRole('button', { name: 'Escuchar llamado de Ana', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  const fallbackRow = page.getByRole('listitem').filter({ has: page.getByText('Fallo de voz', { exact: true }) })
  await fallbackRow.getByRole('button', { name: 'Escuchar audio anunciado de Ana', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  const saved = db.prepare('SELECT resultId,recoveredPartId FROM karaokeCallRequests WHERE queueId=?').get(first)
  assert.equal(saved.resultId, original.id)
  assert.notEqual(saved.recoveredPartId, original.id)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(first).status, 'PLAYED')
  assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation!='compose'`).get().n, generationCount)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, interventionCount)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByText(/Pedidos de karaoke \(/).scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `singing-history-${width}.png`), fullPage: true })
  }
  console.log('Singing history: terminal private review, actual fallback, keyboard recovery, no synthesis/public playback and responsive layout passed.')
}
