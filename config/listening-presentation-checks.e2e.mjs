import { expect } from 'playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { checkListeningTemplateAdmin } from './listening-template-admin-checks.e2e.mjs'

export async function checkListeningPresentations ({ page, player, operator, luis, join, add, emit, db, upload, snapshot, uiBase, data, fail }) {
  const ready = queueId => db.prepare('SELECT * FROM listeningPresentations WHERE queueId=?').get(queueId)
  const played = queueId => db.prepare(`SELECT * FROM animationInterventions WHERE json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL ORDER BY requestedAt DESC LIMIT 1`).get(queueId)
  const toggle = async (enabled) => {
    await page.goto(uiBase + 'admin/settings/animator?view=calls')
    const control = page.getByRole('switch', { name: 'Presentar pedidos para escuchar' })
    await expect(control).toBeEnabled()
    if (await control.isChecked() !== enabled) {
      await control.focus()
      await page.keyboard.press('Space')
    }
    await expect.poll(async () => (await snapshot()).automation.controls.listeningEnabled).toBe(enabled)
  }
  const play = async (queueId) => {
    await expect.poll(() => player.evaluate(hash => window.callTrace.decoded.includes(hash), db.prepare('SELECT checksum FROM karaokeCallParts WHERE id=?').get(ready(queueId).resultId || ready(queueId).signatureId).checksum), { timeout: 15000 }).toBe(true)
    await emit(operator, 'server/PLAYER_REQ_PLAY')
    try {
      await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId)?.status, { timeout: 30000 }).toBe('PLAYED')
    } catch (error) {
      const evidence = await player.evaluate(() => ({ trace: window.karaokePlaybackTrace?.snapshot(), calls: window.callTrace, text: document.body.innerText }))
      fs.writeFileSync(path.join(data, `listening-failure-${queueId}.json`), JSON.stringify(evidence, null, 2))
      await player.screenshot({ path: path.join(data, `listening-failure-${queueId}.png`) })
      console.error('Listening player did not finish:', evidence.text)
      throw error
    }
    await emit(operator, 'server/PLAYER_REQ_PAUSE')
    const intervention = played(queueId)
    assert.equal(intervention?.status, 'PLAYED', JSON.stringify(intervention))
    return JSON.parse(intervention.sequenceJSON).filter(asset => asset.role !== 'bed')
  }
  await upload('listening-ordinary', 'voice', 'turn', 1, 750)
  await toggle(true)
  const first = await add(luis, 7, 'LISTEN')
  await emit(luis, 'server/GREETINGS', { operation: 'attach', queueId: first, message: '¡Una noche para compartir!' })
  await expect.poll(() => ready(first)?.resultId, { timeout: 30000 }).toBeTruthy()
  await expect.poll(() => ready(first)?.signatureId, { timeout: 15000 }).toBeTruthy()
  await expect.poll(() => db.prepare(`SELECT j.status FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.queueId=?`).get(first)?.status).toBe('ready')
  await checkListeningTemplateAdmin({ page, db, snapshot, data, first, fail })
  await page.getByText('Pedidos para escuchar (1)', { exact: true }).click()
  await page.getByRole('button', { name: 'Escuchar presentación de Luis' }).click()
  await expect(page.getByRole('region', { name: 'Escucha privada' })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar escucha' }).click()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.getByRole('switch', { name: 'Presentar pedidos para escuchar' }).scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `listening-controls-${width}.png`), fullPage: true })
  }
  await page.goto('about:blank')
  const firstSequence = await play(first)
  assert.deepEqual(firstSequence.map(asset => asset.role), ['intro', 'call', 'greeting'])
  assert.match(firstSequence[1].displayText, /^Desde la mesa tres,.*Luis$/i)
  const dependencies = JSON.parse(db.prepare('SELECT dependenciesJSON FROM karaokeCallParts WHERE id=?').get(firstSequence[1].partId).dependenciesJSON)
  assert.deepEqual(dependencies.map(id => db.prepare('SELECT kind FROM karaokeCallParts WHERE id=?').get(id).kind), ['table', 'template', 'name'])
  assert.equal(db.prepare('SELECT voiceStatus FROM greetingTurns WHERE turnKey=?').get(first).voiceStatus, 'PLAYED')
  const sameName = await join('Luis', '14')
  const second = await add(sameName, 8, 'LISTEN')
  await expect.poll(() => ready(second)?.resultId, { timeout: 15000 }).toBeTruthy()
  const secondSequence = await play(second)
  assert.match(secondSequence.find(asset => asset.role === 'call').displayText, /^Desde la mesa catorce,.*Luis$/i)
  assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source' AND text='Luis'`).get().n, 1)
  await toggle(false)
  const third = await add(luis, 9, 'LISTEN')
  await emit(luis, 'server/GREETINGS', { operation: 'attach', queueId: third, message: '¡Gracias por esta noche!' })
  await expect.poll(() => ready(third)?.signatureId, { timeout: 15000 }).toBeTruthy()
  await expect.poll(() => db.prepare(`SELECT j.status FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.queueId=?`).get(third)?.status).toBe('ready')
  await page.goto('about:blank')
  const thirdSequence = await play(third)
  assert.deepEqual(thirdSequence.map(asset => asset.role).filter(role => role !== 'intro'), ['greeting', 'signature'])
  assert.equal(thirdSequence.at(-1).displayText, 'De Luis')
  await toggle(true)
  const doubtful = await join('fgr', '01')
  const fourth = await add(doubtful, 10, 'LISTEN')
  await expect.poll(() => ready(fourth)?.resultId, { timeout: 15000 }).toBeTruthy()
  await page.goto('about:blank')
  const fourthSequence = await play(fourth)
  assert.match(fourthSequence.find(asset => asset.role === 'call').displayText, /un invitado/)
  assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source' AND text='fgr'`).get().n, 0)
  const trace = await player.evaluate(() => window.callTrace)
  assert.ok(trace.starts.every(item => item.overlap.filter(kind => kind !== 'bed').length === 0), JSON.stringify(trace.starts))
  fs.writeFileSync(path.join(data, 'listening-presentations.json'), JSON.stringify({ firstSequence, secondSequence, thirdSequence, fourthSequence, trace }, null, 2))
  console.log('Listening presentations: animator/presentation/message order, private preview, keyboard/responsive control, shared Luis, signature with feature off and neutral name passed.')
}
