import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkTransitionPresentation ({ player, uiBase, emit, db, voice, data }) {
  const cases = [
    { kind: 'sing', origin: 'PARTICIPANT', intent: 'SING', title: 'Rayando el sol', artist: 'Maná' },
    { kind: 'listen', origin: 'PARTICIPANT', intent: 'LISTEN', title: 'Vivir mi vida', artist: 'Marc Anthony' },
    { kind: 'house', origin: 'HOUSE', intent: 'LISTEN', title: 'Bailando', artist: 'Enrique Iglesias' },
  ]
  const add = item => Number(db.prepare(`INSERT INTO queue(roomId,userId,songId,prevQueueId,source,title,artistOrChannel,origin,requestIntent,tableLabelSnapshot)
    VALUES(1,1,1,(SELECT max(queueId) FROM queue WHERE status NOT IN ('REMOVED','REJECTED')),'LOCAL',?,?,?,?,?)`)
    .run(item.title, item.artist, item.origin, item.intent, 'Mesa 07').lastInsertRowid)
  const active = () => db.prepare('SELECT count(*) n FROM animationInterventions WHERE status IN (?,?,?)').get('PENDING', 'RESERVED', 'PLAYING').n
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(active).toBe(0)
  const long = { ...cases[0], name: 'Ana y sus amigos de la mesa que nunca deja de cantar',
    title: 'Una canción con un título especialmente largo para compartir con todos los amigos y celebrar juntos otra noche de música y karaoke' }

  for (const incoming of [...cases, long]) for (const following of cases) {
    await emit('server/PLAYER_REQ_PAUSE')
    await expect.poll(active).toBe(0)
    // Release ownership through the application before a full navigation. The
    // isolated HTTPS polling bridge cannot rely on an unload close packet.
    await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(false)
    db.prepare('UPDATE queue SET status=? WHERE status IN (?,?,?)').run('REMOVED', 'APPROVED', 'PLAYING', 'PENDING_APPROVAL')
    db.prepare('UPDATE rooms SET data=json_set(data,?,?,?,?) WHERE roomId=1')
      .run('$.prefs.queue.houseTracksBeforeParticipant', incoming.kind === 'house' ? 1 : 0, '$.prefs.queue.maxSongsPerParticipantRound', 1)
    db.prepare('UPDATE users SET name=? WHERE userId=1').run(incoming.name ?? 'Ana')
    const first = add(incoming)
    const second = add(following)
    await player.setViewportSize({ width: 1920, height: 1080 })
    await player.goto(`${uiBase}player`)
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(voice.checksum)).toBe(true)
    await emit('server/PLAYER_REQ_PLAY')
    await emit('server/ANIMATION_REQUEST', { requestId: crypto.randomUUID(), clipId: voice.id })
    const main = player.getByTestId('transition-incoming')
    const next = player.getByTestId('transition-following')
    await expect(main).toHaveAttribute('data-queue-id', String(first))
    await expect(main).toHaveAttribute('data-kind', incoming.kind)
    await expect(main).toContainText(incoming.title)
    await expect(next).toHaveAttribute('data-queue-id', String(second))
    await expect(next).toHaveAttribute('data-kind', following.kind)
    await expect(next).toContainText(following.title)
    if (incoming.kind === 'sing') {
      await expect(main.getByRole('heading')).toHaveText(incoming.name ?? 'Ana')
      await expect(main).toContainText('Mesa 07')
    } else await expect(main.getByRole('heading')).toHaveText(incoming.title)
    if (incoming.kind === 'house') await expect(main).not.toContainText('Ana')

    // The information is already visible during the lead-in and remains while
    // the existing animator speaks; this batch must not silence that channel.
    await expect.poll(() => player.evaluate(() => window.transitionTrace.active.includes('voice'))).toBe(true)
    await expect(player.getByTestId('transition-scene')).not.toContainText('La próxima canción ya está lista.')
    if (following.kind === 'listen') {
      for (const [width, height] of [[1920, 1080], [390, 844], [844, 480]]) {
        await player.setViewportSize({ width, height })
        await expect(main).toBeVisible()
        await expect(next).toBeVisible()
        await expect.poll(() => player.locator('#player-fs-container').evaluate(element => Math.round(element.clientWidth))).toBe(width)
        await player.screenshot({ path: path.join(data, `presentation-${incoming === long ? 'long' : incoming.kind}-${width}.png`) })
        const fits = await player.getByTestId('transition-presentation').evaluate((element) => {
          const box = element.getBoundingClientRect()
          return [...element.querySelectorAll('header, aside, h1')].every((child) => {
            const rect = child.getBoundingClientRect()
            return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
          })
        })
        assert.ok(fits, `${incoming.kind} presentation must fit ${width}×${height}`)
      }
    }
  }
  await emit('server/PLAYER_REQ_PAUSE')
  await expect.poll(active).toBe(0)
  console.log('PASS all nine incoming/following track types, long metadata, existing animator audio and desktop/mobile/landscape presentation')
}
