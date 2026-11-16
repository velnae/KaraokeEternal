import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { assertKaraokeArrival, assertKaraokeHandoff, assertKaraokeReminders, recordKaraokeChoreography } from './karaoke-stage-checks.e2e.mjs'

export async function checkManualKaraokeStart ({ page, player, operator, emit, db, call, snapshot, uiBase, data, queueId, stage, followingIds }) {
  const turn = () => db.prepare('SELECT * FROM karaokeStartTurns WHERE roomId=1').get()
  await expect.poll(() => turn()?.phase, { timeout: 30000 }).toBe('waiting')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'APPROVED')
  const voiceCount = db.prepare(`SELECT count(*) n FROM animationInterventions WHERE json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL`).get(queueId).n
  assert.equal(voiceCount, 1)
  if (stage) await assertKaraokeArrival({ player, db, queueId, stage, followingIds, data })
  const sourceCount = db.prepare('SELECT count(*) n FROM greetingVoiceRequests').get().n
  const beds = await player.evaluate(() => window.callTrace.starts.filter(item => item.kind === 'karaoke-bed').length)
  await page.goto(uiBase + 'queue', { waitUntil: 'domcontentloaded', timeout: 60000 })
  const card = page.locator(`[data-queue-id="${queueId}"]`).first()
  await expect(card.getByRole('button', { name: 'Iniciar karaoke', exact: true })).toBeEnabled()
  // Cross the original 40-second permit: one loop must renew without restarting.
  const waitMs = stage && process.env.KARAOKE_E2E_STAGE_SHORT !== '1' ? 125000 : 41000
  await player.waitForTimeout(waitMs)
  assert.equal(turn().phase, 'waiting')
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'APPROVED')
  assert.equal(await player.evaluate(() => window.callTrace.starts.filter(item => item.kind === 'karaoke-bed').length), beds)
  if (stage) assertKaraokeReminders(db, queueId, waitMs)
  const state = (await emit(operator, 'server/ANIMATION_SYNC')).payload
  assert.ok(state.ambience?.until > Date.now())
  const request = { queueId, runId: turn().runId, revision: turn().revision }
  await card.getByRole('button', { name: 'Iniciar karaoke', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => turn()?.phase).toBe('countdown')
  const endsAt = turn().endsAt
  await emit(operator, 'server/KARAOKE_TURN', { ...request, operation: 'start' })
  assert.equal(turn().endsAt, endsAt, 'A second operator must not restart the countdown')
  await expect(player.getByRole('status', { name: 'Cuenta regresiva de karaoke', exact: true })).toBeVisible()
  if (stage) {
    await expect(player.getByTestId('karaoke-mascot')).toBeVisible()
    await expect.poll(() => db.prepare(`SELECT count(*) n FROM animationInterventions WHERE json_extract(karaokeCueJSON,'$.kind')='countdown' AND startedAt IS NOT NULL`).get().n).toBe(1)
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await player.setViewportSize({ width, height: 900 })
    await expect.poll(() => player.locator('#player-fs-container').evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(width)
    await card.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(data, `karaoke-start-queue-${width}.png`) })
    await player.screenshot({ path: path.join(data, `karaoke-start-countdown-${width}.png`) })
  }
  await card.getByRole('button', { name: 'Cancelar inicio', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => turn()?.phase).toBe('waiting')
  await expect(player.getByRole('status', { name: 'Cuenta regresiva de karaoke', exact: true })).not.toBeVisible()
  await player.waitForTimeout(5500)
  assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, 'APPROVED')
  assert.equal(db.prepare(`SELECT count(*) n FROM animationInterventions WHERE json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL`).get(queueId).n, voiceCount)
  assert.equal(db.prepare('SELECT count(*) n FROM greetingVoiceRequests').get().n, sourceCount)
  await card.getByRole('button', { name: 'Iniciar karaoke', exact: true }).click()
  await expect.poll(() => turn()?.phase).toBe('countdown')
  const expectedEnd = turn().endsAt
  if (stage) await assertKaraokeHandoff({ player, queueId, data })
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(queueId).status, { timeout: 30000 }).toBe('PLAYED')
  assert.ok(Date.now() >= expectedEnd)
  assert.equal(turn()?.phase, 'played')
  if (stage) {
    await expect.poll(() => db.prepare(`SELECT status FROM animationInterventions WHERE json_extract(karaokeCueJSON,'$.queueId')=? AND json_extract(karaokeCueJSON,'$.kind')='ended' ORDER BY requestedAt DESC LIMIT 1`).get(queueId)?.status, { timeout: 15000 }).toBe('PLAYED')
    await recordKaraokeChoreography({ player, db, queueId, stage, data, waitMs })
    assert.equal(db.prepare('SELECT count(*) n FROM greetingVoiceRequests').get().n, sourceCount, 'Waiting and effects must reuse audio without synthesizing again')
    const settings = (await call('rooms/1/karaoke-calls/backgrounds')).settings
    await call('rooms/1/karaoke-calls/backgrounds', { ...stage.original, revision: settings.revision }, 'PUT')
    console.log(`Karaoke stage: real GIF through wait/countdown, ${waitMs / 1000}s uninterrupted bed, saved-table reminders every 10s, exclusive audio receipts, cancellation and natural-end applause passed.`)
  }
  await call('rooms/1/karaoke-calls/automation', { ...(await snapshot()).automation.controls, automaticStart: true }, 'PUT')
  console.log('Manual karaoke: one announcement, renewable wait >40s, same resources, approved until music, synchronized/deduplicated countdown, keyboard cancel/reconfirm and responsive real-player design passed.')
}
