import { expect } from 'playwright/test'
import { io } from 'socket.io-client'
import path from 'node:path'
import assert from 'node:assert/strict'

// The caller supplies only its isolated test backend and temporary database.
export async function checkParticipantStatuses ({ page, api, db, base, uiBase, data, queueId }) {
  const login = await api.post(`${base}api/login`, { data: { username: 'admin', password: 'preview-only-password', roomId: 1 } })
  assert.equal(login.status(), 200)
  const cookie = (await api.storageState()).cookies.map(entry => `${entry.name}=${entry.value}`).join('; ')
  const player = io(new URL(base).origin, { path: new URL('socket.io', base).pathname, transports: ['websocket'], extraHeaders: { cookie } })
  const report = async (currentId, history, position = 0) => {
    const response = await player.timeout(10000).emitWithAck('action', {
      type: 'server/PLAYER_EMIT_STATUS',
      payload: { queueId: currentId, historyJSON: JSON.stringify(history), position, isPlaying: true, isAtQueueEnd: false, nextUserId: -1 },
    })
    assert.equal(response.error, undefined)
  }
  const snapshots = async (state) => {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(data, `request-${state}-${width}.png`) })
    }
  }
  try {
    await new Promise((resolve, reject) => {
      player.once('connect', resolve)
      player.once('connect_error', reject)
    })
    await page.goto(`${uiBase}requests`)
    const card = page.locator(`[data-queue-id="${queueId}"]`)
    await expect(card.getByText('Por aprobar', { exact: true })).toBeVisible()
    await expect(card.getByText('Karaoke', { exact: true })).toHaveCount(0)
    await snapshots('pending')

    const insertTrack = db.prepare(`INSERT INTO queue(roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin,status,durationSeconds,dateCreated,dateUpdated,requestIntent)
      VALUES(1,1,?,'YOUTUBE','fixture0004',?,'Fixture',?,'APPROVED',180,?,?, 'LISTEN')`)
    const now = Math.floor(Date.now() / 1000)
    const currentTrack = Number(insertTrack.run(null, 'Another participant', 'PARTICIPANT', now - 200, now).lastInsertRowid)
    const house2 = Number(insertTrack.run(currentTrack, 'House music', 'HOUSE', now - 199, now).lastInsertRowid)
    db.prepare('UPDATE queue SET status=?,prevQueueId=?,requestIntent=? WHERE queueId=?').run('APPROVED', house2, 'LISTEN', queueId)
    await report(currentTrack, [], 60)
    await expect(card.getByText('En cola', { exact: true })).toBeVisible()
    await expect(card.getByText('≈ 5 min', { exact: true })).toBeVisible()
    await expect(card.getByText('Para escuchar', { exact: true })).toHaveCount(0)
    await expect(card.getByText(/turnos? (por delante|de cliente)/)).toHaveCount(0)
    await expect(page.getByText(/Tu turno sigue/)).toHaveCount(0)
    await snapshots('queued')

    await report(house2, [currentTrack], 30)
    await expect(card.getByText('Sigue tu canción', { exact: true })).toBeVisible()
    await expect(card.getByText('En cola', { exact: true })).toHaveCount(0)
    await expect(card.locator('[aria-label^="Espera estimada:"]')).toHaveCount(0)
    await snapshots('next')

    await player.timeout(10000).emitWithAck('action', { type: 'server/PLAYER_EMIT_LEAVE' })
    await expect(card.getByText('En cola', { exact: true })).toBeVisible()
    await expect(card.getByText('Sigue tu canción', { exact: true })).toHaveCount(0)
    await report(house2, [currentTrack], 30)
    await expect(card.getByText('Sigue tu canción', { exact: true })).toBeVisible()

    await report(queueId, [currentTrack, house2], 10)
    await expect(card.getByText('Reproduciendo', { exact: true })).toBeVisible()
    await expect(card.getByText('Sigue tu canción', { exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Cancelar pedido', exact: true })).toHaveCount(0)
    await snapshots('playing')
    console.log('PASS Single personal status: pending, queued behind house music, next, disconnected and playing')
  } finally {
    player.disconnect()
  }
}
