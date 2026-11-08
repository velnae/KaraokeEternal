import { expect } from 'playwright/test'
import assert from 'node:assert/strict'

// All writes belong to the caller's isolated fixture database and server.
export async function checkHouseTransitionRevalidation ({ player, db, emit, call, uiBase, getStatus }) {
  let scenario = 0
  const prepare = async (kind, count, houseLimit = 2) => {
    await emit('server/PLAYER_REQ_PAUSE')
    // Release authority before navigating: the HTTPS polling bridge cannot
    // reliably deliver a leave packet while the whole document is unloading.
    await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(false)
    await emit('server/QUEUE_CLEANUP', {
      operation: 'pending', confirmed: true, requestId: crypto.randomUUID(),
      throughQueueId: db.prepare('SELECT max(queueId) id FROM queue').get().id,
      roomId: 1, expiresAt: Date.now() + 15000,
    })
    const room = (await call('rooms/1')).entities[1]
    await call('rooms/1', { ...room, prefs: { ...room.prefs,
      queue: { ...room.prefs.queue, houseTracksBeforeParticipant: houseLimit },
    } }, 'PUT')
    const animation = (await emit('server/ANIMATION_SYNC')).payload
    await emit('server/ANIMATION_CONTROL', { ...animation.prefs, controlVersion: animation.controlVersion,
      enabled: true, automation: false, ambienceEnabled: false, expiresAt: Date.now() + 3000 })
    const userId = 200 + scenario++ * 3
    for (let index = 0; index < 3; index++) {
      db.prepare('INSERT INTO users(userId,username,password,name,roleId) VALUES(?,?,?,?,4)')
        .run(userId + index, `transition-${userId + index}`, '', `Customer ${userId + index}`)
    }
    const now = Math.floor(Date.now() / 1000)
    const add = (owner, title, origin = 'PARTICIPANT', status = 'APPROVED', created = now - 100) => Number(db.prepare(`
      INSERT INTO queue(roomId,userId,songId,prevQueueId,source,title,artistOrChannel,origin,status,dateCreated,dateUpdated,durationSeconds,requestIntent)
      VALUES(1,?,1,(SELECT max(queueId) FROM queue WHERE status NOT IN ('REMOVED','REJECTED')),'LOCAL',?,'Fixture',?,?,?,?,120,'LISTEN')`)
      .run(owner, title, origin, status, created, created).lastInsertRowid)
    add(1, `Previous ${kind}`, 'PARTICIPANT', 'PLAYED', now)
    const house = add(1, `House ${kind}`, 'HOUSE')
    const first = add(userId, `Waiting ${kind}`)
    if (count === 2) add(userId + 1, `Second ${kind}`, 'PARTICIPANT', 'APPROVED', now - 90)
    // A real visual greeting proves that the replacement turn gets its own
    // presentation instead of being played under the old house transition.
    db.prepare(`INSERT INTO greetings(queueId,roomId,userId,sender,message,createdAt)
      VALUES(?,1,?,'Customer','Este es el saludo del cliente',?)`).run(first, userId, Date.now())
    await player.goto(`${uiBase}player`)
    await expect.poll(() => getStatus().queueId).toBe(-1)
    await player.getByRole('toolbar', { name: 'Controles de reproducción' }).getByRole('button', { name: 'Reproducir', exact: true }).click()
    const incoming = player.getByTestId('transition-incoming')
    await expect(incoming).toHaveAttribute('data-queue-id', String(houseLimit ? house : first))
    await expect.poll(() => getStatus().queueDecisionAt).toBeGreaterThan(0)
    return { house, first, incoming, third: () => add(userId + 2, `Third ${kind}`, 'PARTICIPANT', 'APPROVED', Math.floor(Date.now() / 1000)) }
  }
  const stateOf = id => db.prepare('SELECT status FROM queue WHERE queueId=?').get(id).status
  const customerStarts = async ({ first, house, incoming }) => {
    await expect(incoming).toHaveAttribute('data-queue-id', String(first))
    await expect(player.getByText('Este es el saludo del cliente', { exact: true })).toBeVisible({ timeout: 15000 })
    assert.equal(stateOf(house), 'APPROVED')
    await expect.poll(() => getStatus().queueId, { timeout: 20000 }).toBe(first)
    await expect.poll(() => stateOf(first)).toBe('PLAYING')
    await expect.poll(() => player.locator('video[src*="/api/media/"]').evaluate(video => !video.paused && video.currentTime > 0)).toBe(true)
    assert.equal(stateOf(house), 'APPROVED', 'House filler must not start or be consumed')
    assert.equal(db.prepare('SELECT count(*) n FROM greetingTurns WHERE turnKey=?').get(first).n, 1)
  }

  const backlog = await prepare('backlog', 2)
  await emit('server/QUEUE_APPROVE', { queueId: backlog.third() })
  await customerStarts(backlog)
  console.log('PASS third request during house intro yields to a customer with its own greeting; house stays pending')

  const aging = await prepare('aging', 1)
  const decisionAt = getStatus().queueDecisionAt
  // At the original decision time it is still below the threshold; only a
  // fresh clock at the end of the real two-second intro can see >=600 seconds.
  db.prepare('UPDATE queue SET dateCreated=? WHERE queueId=?').run(decisionAt - 599, aging.first)
  await emit('server/QUEUE_APPROVE', { queueId: aging.first })
  await customerStarts(aging)
  assert.ok(getStatus().queueDecisionAt >= decisionAt + 1)
  console.log('PASS ten-minute waiting threshold crossed inside transition is evaluated with a fresh clock')

  const reserved = await prepare('reserved-customer', 2, 0)
  await emit('server/QUEUE_APPROVE', { queueId: reserved.third() })
  await customerStarts(reserved)
  console.log('PASS newly arriving requests do not displace an already reserved customer')

  const started = await prepare('already-playing', 2)
  await expect.poll(() => stateOf(started.house), { timeout: 15000 }).toBe('PLAYING')
  await emit('server/QUEUE_APPROVE', { queueId: started.third() })
  await expect.poll(() => player.locator('video[src*="/api/media/"]').evaluate(video => video.currentTime > 1)).toBe(true)
  assert.equal(getStatus().queueId, started.house, 'Already playing house music is not interrupted')
  await emit('server/PLAYER_REQ_NEXT')
  await expect(player.getByText('Este es el saludo del cliente', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect.poll(() => stateOf(started.first), { timeout: 20000 }).toBe('PLAYING')
  console.log('PASS eligible house music can start and finishes its turn when demand grows after playback starts')
}
