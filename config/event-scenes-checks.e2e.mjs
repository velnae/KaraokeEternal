import { expect } from 'playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { checkSceneAuthoring } from './event-scene-authoring-checks.e2e.mjs'
import { checkSceneRegressions } from './event-scene-regressions.e2e.mjs'
import { checkSceneLinks } from './event-scene-links-checks.e2e.mjs'
import { checkSceneWorkspace } from './event-scene-workspace-checks.e2e.mjs'
import { checkSceneFullscreen } from './event-scene-fullscreen-checks.e2e.mjs'

export async function checkEventScenes ({ player, uiBase, call, emit, db, data, voice, bed, background, effect }) {
  await emit('server/PLAYER_REQ_PAUSE')
  db.prepare('UPDATE queue SET status=\'PLAYED\'').run()
  await checkSceneRegressions({ player, uiBase, call, voice, effect, data })
  await checkSceneWorkspace({ player, uiBase, call, data })
  await checkSceneFullscreen({ player, uiBase, call, data })
  await player.goto(`${uiBase}admin/settings/animator?view=scenes`)
  await player.getByRole('combobox', { name: 'Evento', exact: true }).selectOption('transition')
  await player.getByText('Plantilla y datos de prueba', { exact: true }).click()
  await player.getByLabel('Inicio respecto al final del video (s)').fill('-2')
  await player.getByRole('group', { name: 'Línea de tiempo', exact: true }).getByRole('button', { name: /^Presentación del pedido/ }).click()
  await player.getByLabel('Referencia').selectOption('mediaEnd')
  await player.getByLabel('Desplazamiento (s)', { exact: true }).fill('0')
  await player.getByLabel('Recurso').selectOption(voice.id)
  await player.getByLabel('Mantener ambiente hasta la siguiente canción').check()
  await player.getByRole('group', { name: 'Línea de tiempo', exact: true }).getByRole('button', { name: 'Fondo del evento', exact: true }).click()
  await player.getByLabel('Referencia').selectOption('mediaEnd')
  await player.getByLabel('Recurso').selectOption(background.id)
  await player.getByRole('button', { name: 'Guardar y usar', exact: true }).click()
  await expect(player.getByText('Plantilla en uso.', { exact: true })).toBeVisible()
  let settings = (await call('animation/scenes/')).settings
  assert.equal(settings.selected.transition, 'transition')
  assert.equal(settings.templates.find(scene => scene.id === 'transition').startOffsetMs, -2000)
  const before = db.prepare('SELECT count(*) count FROM animationInterventions').get().count
  const preview = player.getByRole('region', { name: 'Vista previa de la coreografía', exact: true })
  await preview.getByRole('button', { name: 'Previsualizar', exact: true }).click()
  await expect(preview.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  assert.equal(db.prepare('SELECT count(*) count FROM animationInterventions').get().count, before)
  await preview.getByRole('button', { name: 'Detener', exact: true }).click()
  const authored = await checkSceneAuthoring({ player, call, effect, background })
  await checkSceneLinks({ player, authored, voice, data })
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await player.setViewportSize({ width, height })
    await player.getByRole('group', { name: 'Línea de tiempo', exact: true }).getByRole('button', { name: effect.title, exact: true }).click()
    await player.getByRole('region', { name: 'Propiedades del elemento', exact: true }).screenshot({ path: path.join(data, `event-reference-${width}.png`) })
    await player.getByLabel('Inicio respecto al final del video (s)').focus()
    await player.keyboard.press('ArrowUp')
    await expect(player.getByLabel('Inicio respecto al final del video (s)')).toHaveValue('-1.9')
    await player.keyboard.press('ArrowDown')
    assert.ok(await player.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await player.screenshot({ path: path.join(data, `event-scenes-${width}.png`), fullPage: true })
    await player.getByRole('group', { name: 'Línea de tiempo', exact: true }).screenshot({ path: path.join(data, `event-timeline-${width}.png`) })
  }
  await player.setViewportSize({ width: 1440, height: 1000 })
  await player.context().addInitScript(() => {
    window.sceneEndTimes = []
    document.addEventListener('ended', (event) => {
      if (event.target === window.youtubeTransition?.video) window.sceneEndTimes.push(performance.now())
    }, true)
  })
  await player.context().addInitScript((id) => {
    window.sceneLeadTimes = []
    document.addEventListener('DOMContentLoaded', () => {
      let present = false
      new MutationObserver(() => {
        const active = !!document.querySelector(`[data-scene-cue="${id}"]`)
        if (active && !present) window.sceneLeadTimes.push(performance.now())
        present = active
      }).observe(document.body, { childList: true, subtree: true })
    })
  }, authored.leadTextId)
  for (const [offset, voiceAnchor] of [[-2000, 'mediaEnd'], [0, 'mediaEnd'], [2000, 'mediaEnd'], [-2000, 'start']]) {
    await emit('server/PLAYER_REQ_PAUSE')
    settings = (await call('animation/scenes/')).settings
    const scene = settings.templates.find(scene => scene.id === 'transition')
    scene.startOffsetMs = offset
    scene.cues.find(cue => cue.slot === 'announcement' && cue.binding !== 'resource').anchor = voiceAnchor
    scene.cues.find(cue => cue.slot === 'ambience').resourceId = bed.id
    await call('animation/scenes/', settings, 'PUT')
    db.prepare('UPDATE queue SET status=\'PLAYED\' WHERE status IN (\'APPROVED\',\'PLAYING\')').run()
    const insert = db.prepare(`INSERT INTO queue(roomId,userId,prevQueueId,source,externalId,title,artistOrChannel,origin,requestIntent)
      VALUES(1,1,(SELECT max(queueId) FROM queue),'YOUTUBE','fixture0001',?,'Fixture','OPERATOR','LISTEN')`)
    const first = Number(insert.run(`Scene ${offset} A`).lastInsertRowid)
    const second = Number(insert.run(`Scene ${offset} B`).lastInsertRowid)
    let snapshot = (await emit('server/ANIMATION_SYNC')).payload
    await emit('server/ANIMATION_CONTROL', { controlVersion: snapshot.controlVersion, enabled: true, automation: true,
      ambienceEnabled: true, ambienceClipId: bed.id, events: { welcome: false, turn: true, closing: false, invitation: false, celebration: false, goodbye: false, booth: false, promotion: false } })
    const response = await player.goto(`${uiBase}player`)
    assert.equal(response.status(), 200, 'The development/player document must load successfully')
    await expect(player.locator('body')).toContainText('Sala 1', { timeout: 20000 })
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.readyClips.includes(bed.checksum), { timeout: 20000 }).toBe(true)
    await emit('server/PLAYER_REQ_PLAY')
    await expect(player.locator(`[data-scene-cue="${authored.textId}"]`)).toHaveCSS('color', 'rgb(255, 238, 0)')
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(first).status, { timeout: 20000 }).toBe('PLAYING')
    await player.evaluate(() => {
      window.transitionTrace.starts = []
      window.sceneEndTimes = []
      window.sceneLeadTimes = []
    })
    if (offset < 0) {
      await expect.poll(() => player.evaluate(() => window.transitionTrace.starts.some(event => event.kind === 'ambience')), { timeout: 10000 }).toBe(true)
      assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(first).status, 'PLAYING', 'pre-roll must not finish the outgoing song')
      const outgoing = await player.evaluate(() => ({ paused: window.youtubeTransition.video.paused, volume: window.youtubeTransition.video.volume }))
      assert.equal(outgoing.paused, false)
      assert.ok(outgoing.volume > 0, 'the tail must remain audible')
    }
    await expect.poll(() => db.prepare('SELECT status FROM queue WHERE queueId=?').get(second).status, { timeout: 25000 }).toBe('PLAYING')
    const timing = await player.evaluate(() => ({ end: window.sceneEndTimes[0], starts: window.transitionTrace.starts, leads: window.sceneLeadTimes }))
    const ambience = timing.starts.find(event => event.kind === 'ambience')
    assert.ok(ambience && timing.end)
    const delta = ambience.at - timing.end
    if (offset < 0) assert.ok(delta < -300, `pre-roll started ${delta}ms relative to end`)
    if (offset === 0) assert.ok(delta >= -100 && delta < 2500, `zero offset started ${delta}ms relative to end`)
    if (offset > 0) assert.ok(delta >= 1500, `positive offset started too soon: ${delta}ms`)
    assert.equal(db.prepare('SELECT status FROM queue WHERE queueId=?').get(first).status, 'PLAYED')
    assert.equal(timing.starts.filter(event => event.kind === 'voice').length, 1, `one presentation per natural boundary: ${JSON.stringify({ timing, state: (await emit('server/ANIMATION_SYNC')).payload.lastOmission, history: await call('animation/history') })}`)
    assert.equal(timing.starts.filter(event => event.kind === 'effect').length, 1, 'the independently added effect actually plays once')
    const speech = timing.starts.find(event => event.kind === 'voice')
    const effectStart = timing.starts.find(event => event.kind === 'effect')
    assert.ok(effectStart.at - speech.at >= voice.durationMs + 150, 'effect waits for the real voice end plus its explicit block offset')
    assert.ok(timing.leads[0] < effectStart.at - 200 && timing.leads[0] > effectStart.at - 800, `text leads its referenced effect by approximately 500ms: ${JSON.stringify(timing)}`)
    if (voiceAnchor === 'start') assert.ok(timing.starts.find(event => event.kind === 'voice').at < timing.end - 300, 'a voice explicitly placed in the pre-roll starts before the actual end')
    console.log(`PASS event scene offset ${offset}ms, actual ambience ${Math.round(delta)}ms; natural end and one presentation`)
    await emit('server/PLAYER_REQ_PAUSE')
    await player.getByRole('link', { name: 'Volver a la cola', exact: true }).click()
    await expect.poll(async () => (await emit('server/ANIMATION_SYNC')).payload.playerPresent).toBe(false)
  }
  console.log(`PASS editable scene persistence, private preview, keyboard and responsive screenshots: ${data}`)
}
