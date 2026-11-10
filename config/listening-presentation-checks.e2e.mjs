import { expect } from 'playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { checkListeningTemplateAdmin } from './listening-template-admin-checks.e2e.mjs'
import { checkListeningRebuilds } from './listening-rebuild-checks.e2e.mjs'

export async function checkListeningPresentations ({ page, player, operator, luis, join, add, emit, db, upload, snapshot, uiBase, data, fail }) {
  let releaseColdAudio = false
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
  const play = async (queueId, cold = false) => {
    if (!cold) await expect.poll(() => player.evaluate(hash => window.callTrace.decoded.includes(hash), db.prepare('SELECT checksum FROM karaokeCallParts WHERE id=?').get(ready(queueId).resultId || ready(queueId).signatureId).checksum), { timeout: 15000 }).toBe(true)
    if (cold) releaseColdAudio = true
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
    if (cold) fs.writeFileSync(path.join(data, 'cold-listening.json'), JSON.stringify({ intervention, trace: await player.evaluate(() => window.karaokePlaybackTrace.snapshot()) }, null, 2))
    assert.equal(intervention?.status, 'PLAYED', JSON.stringify(intervention))
    return JSON.parse(intervention.sequenceJSON).filter(asset => asset.role !== 'bed')
  }
  await upload('listening-ordinary', 'voice', 'turn', 1, 750)
  await toggle(true)
  // Reproduce a prepared server asset that becomes downloadable only during
  // the transition, after the initial curtain. Do not teach Play to await decode.
  const audioPattern = '**/karaoke-calls/requests/*/audio/*'
  await player.route(audioPattern, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)
    if (db.prepare('SELECT kind FROM karaokeCallParts WHERE id=?').get(id)?.kind !== 'composition') return route.fallback()
    if (!releaseColdAudio) return route.fulfill({ status: 503, body: 'Delayed fixture audio' })
    await new Promise(resolve => setTimeout(resolve, 3500))
    await route.fallback()
  })
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
  const firstSequence = await play(first, true)
  await player.unroute(audioPattern)
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
  // Keep listening enabled, but remove only this composition. The attributed
  // greeting must survive server reconciliation throughout the intro and voice.
  const clara = await join('Clara', '03')
  const fallback = await add(clara, 12, 'LISTEN')
  await emit(clara, 'server/GREETINGS', { operation: 'attach', queueId: fallback, message: '¡Gracias por compartir esta noche!' })
  await expect.poll(() => !!ready(fallback)?.resultId && !!ready(fallback)?.signatureId, { timeout: 30000 }).toBe(true)
  await expect.poll(() => db.prepare(`SELECT j.status FROM greetingAudioJobs j JOIN greetings g ON g.audioJobId=j.jobId WHERE g.queueId=?`).get(fallback)?.status).toBe('ready')
  const failedPart = ready(fallback).resultId
  const tablePart = JSON.parse(db.prepare('SELECT dependenciesJSON FROM karaokeCallParts WHERE id=?').get(failedPart).dependenciesJSON)[0]
  const tableMaster = path.join(data, 'animation/calls', db.prepare('SELECT master FROM karaokeCallParts WHERE id=?').get(tablePart).master)
  const originalMaster = fs.readFileSync(tableMaster)
  fs.writeFileSync(tableMaster, 'Unavailable local master fixture')
  db.prepare('UPDATE karaokeCallParts SET retired=1 WHERE id=?').run(failedPart)
  db.prepare(`UPDATE karaokeCallJobs SET status='failed',resultId=NULL,error='Fixture assembly failed' WHERE operation='compose' AND resultId=?`).run(failedPart)
  await expect.poll(() => ready(fallback)?.resultId).toBeNull()
  const fallbackSequence = await play(fallback)
  fs.writeFileSync(tableMaster, originalMaster)
  assert.deepEqual(fallbackSequence.map(asset => asset.role).filter(role => role !== 'intro'), ['greeting', 'signature'])
  assert.equal(db.prepare('SELECT voiceStatus FROM greetingTurns WHERE turnKey=?').get(fallback).voiceStatus, 'PLAYED')
  // An unavailable asset must produce a specific persisted omission and let music continue.
  await player.route(audioPattern, route => route.fulfill({ status: 503, body: 'Unavailable fixture audio' }))
  const elena = await join('Elena', '03')
  const unavailable = await add(elena, 11, 'LISTEN')
  await expect.poll(() => ready(unavailable)?.resultId, { timeout: 15000 }).toBeTruthy()
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(unavailable)?.status, { timeout: 30000 }).toBe('PLAYED')
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  await player.unroute(audioPattern)
  assert.equal(played(unavailable), undefined)
  assert.equal(db.prepare('SELECT playbackReason FROM listeningPresentations WHERE queueId=?').get(unavailable).playbackReason, 'audio-not-ready')

  // Review completed presentations and names privately, then recover a legacy retired output.
  const sourceCount = db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source'`).get().n
  const interventionCount = db.prepare('SELECT count(*) n FROM animationInterventions').get().n
  const old = db.prepare('SELECT p.* FROM karaokeCallParts p JOIN listeningPresentations l ON l.resultId=p.id WHERE l.queueId=?').get(first)
  db.prepare('UPDATE karaokeCallParts SET retired=1 WHERE id=?').run(old.id)
  for (const file of [old.master, old.filename]) fs.rmSync(path.join(data, 'animation/calls', file))
  await page.goto(uiBase + 'admin/settings/animator?view=calls')
  await page.getByRole('link', { name: 'Gestionar nombres de todas las salas' }).click()
  await page.getByLabel('Buscar nombre').fill('Luis')
  await page.getByRole('button', { name: 'Escuchar nombre Luis', exact: true }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  await page.goto(uiBase + 'admin/settings/animator?view=calls')
  await page.getByText(/Pedidos para escuchar \(/).click()
  const history = page.getByRole('listitem').filter({ has: page.getByText('Listen one', { exact: true }) })
  await history.getByRole('button', { name: 'Recuperar audio' }).focus()
  await page.keyboard.press('Enter')
  await expect(history.getByRole('button', { name: /^Escuchar presentación de/ })).toBeVisible({ timeout: 15000 })
  await history.getByRole('button', { name: /^Escuchar presentación de/ }).click()
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('audio').evaluate(audio => audio.play())
  await expect.poll(() => page.locator('audio').evaluate(audio => audio.ended)).toBe(true)
  await page.getByRole('button', { name: 'Cerrar escucha', exact: true }).click()
  assert.notEqual(ready(first).resultId, old.id)
  assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source'`).get().n, sourceCount)
  assert.equal(db.prepare('SELECT count(*) n FROM animationInterventions').get().n, interventionCount)
  await checkListeningRebuilds({ player, operator, luis, add, emit, db, data, play, ready, played, originalQueueId: first })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.getByText(/Pedidos para escuchar \(/).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(data, `listening-history-${width}.png`), fullPage: true })
    await page.getByRole('link', { name: 'Gestionar nombres de todas las salas' }).click()
    await page.screenshot({ path: path.join(data, `listening-names-${width}.png`), fullPage: true })
    await page.goto(uiBase + 'admin/settings/animator?view=calls')
    await page.getByText(/Pedidos para escuchar \(/).click()
  }
  const trace = await player.evaluate(() => window.callTrace)
  assert.ok(trace.starts.every(item => item.overlap.filter(kind => kind !== 'bed').length === 0), JSON.stringify(trace.starts))
  fs.writeFileSync(path.join(data, 'listening-presentations.json'), JSON.stringify({ firstSequence, secondSequence, thirdSequence, fourthSequence, fallbackSequence, trace }, null, 2))
  console.log('Listening presentations: cold download, reserved signature fallback after failed composition, specific omission, saved names, historical private recovery, keyboard/responsive controls and attributed playback passed.')
}
