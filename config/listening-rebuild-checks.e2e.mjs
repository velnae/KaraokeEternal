import { expect } from 'playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export async function checkListeningRebuilds ({ player, operator, luis, add, emit, db, data, play, ready, played, originalQueueId }) {
  const binding = ready(originalQueueId)
  const original = db.prepare('SELECT * FROM karaokeCallParts WHERE id=?').get(binding.resultId)
  const receipt = db.prepare(`SELECT id FROM karaokeCallJobs WHERE operation='compose' AND purpose='setup'
    AND json_extract(inputJSON,'$.sourceIds')=? ORDER BY createdAt LIMIT 1`).get(original.dependenciesJSON)
  const sourceCount = db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source'`).get().n
  const invalidateRecipe = () => {
    db.prepare('UPDATE karaokeCallParts SET retired=1 WHERE dependenciesJSON=?').run(original.dependenciesJSON)
    db.prepare(`UPDATE karaokeCallJobs SET status='failed',resultId=NULL,error='Historical local assembly failure'
      WHERE operation='compose' AND json_extract(inputJSON,'$.sourceIds')=?`).run(original.dependenciesJSON)
  }
  const request = async (songId) => {
    const id = await add(luis, songId, 'LISTEN')
    db.prepare('UPDATE listeningPresentations SET templateId=?,templatePartId=?,resultId=NULL WHERE queueId=?').run(binding.templateId, binding.templatePartId, id)
    // The first reconciliation may not have created the binding yet.
    db.prepare(`INSERT OR IGNORE INTO listeningPresentations(roomId,queueId,inputKey,templateId,templatePartId)
      VALUES(1,?,'pending',?,?)`).run(id, binding.templateId, binding.templatePartId)
    await expect.poll(() => ready(id)?.resultId, { timeout: 15000 }).toBeTruthy()
    const part = db.prepare('SELECT dependenciesJSON FROM karaokeCallParts WHERE id=?').get(ready(id).resultId)
    assert.equal(part.dependenciesJSON, original.dependenciesJSON)
    assert.equal(db.prepare('SELECT status FROM karaokeCallJobs WHERE id=?').get(receipt.id).status, 'failed')
    assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source'`).get().n, sourceCount)
    return id
  }
  invalidateRecipe()
  const normal = await request(14)
  await play(normal)
  assert.equal(played(normal).status, 'PLAYED')

  invalidateRecipe()
  const source = await add(operator, 13, 'LISTEN', 'HOUSE')
  await emit(operator, 'server/PLAYER_REQ_PLAY')
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(source)?.status).toBe('PLAYING')
  const target = await request(15)
  const media = player.locator('video:not([data-media-role="transition-background"])')
  await expect.poll(() => media.evaluate(video => video.duration)).toBeGreaterThan(10)
  const seek = await media.evaluate((video) => {
    const before = video.currentTime
    video.currentTime = video.duration - 5
    return { before, position: video.currentTime, duration: video.duration }
  })
  assert.ok(seek.position > seek.before, JSON.stringify(seek))
  assert.ok(Math.abs(seek.duration - seek.position - 5) < 0.1, JSON.stringify(seek))
  await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(target)?.status, { timeout: 30000 }).toBe('PLAYED')
  await emit(operator, 'server/PLAYER_REQ_PAUSE')
  assert.equal(played(target)?.status, 'PLAYED')
  assert.equal(db.prepare(`SELECT count(*) n FROM animationInterventions WHERE json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL`).get(target).n, 1)
  assert.equal(db.prepare(`SELECT count(*) n FROM karaokeCallJobs WHERE operation='source'`).get().n, sourceCount)
  fs.writeFileSync(path.join(data, 'listening-rebuild-seek.json'), JSON.stringify({ normal, source, target, seek,
    trace: await player.evaluate(() => window.karaokePlaybackTrace.snapshot()) }, null, 2))
  console.log('Listening rebuilds: historical failure reused safely, no synthesis, normal boundary and seek to five seconds before end passed.')
}
