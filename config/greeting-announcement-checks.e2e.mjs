import { expect } from 'playwright/test'
import path from 'node:path'

export async function checkGreetingAnnouncements ({ player, call, emit, db, uiBase, data }) {
  const settings = (await call('prefs')).playerDisplay
  await call('prefs/player-display', { ...settings, announcement: {
    ...settings.announcement, enabled: true, alignment: 'center', intervalSeconds: 5,
    messages: [{ title: 'Aviso uno', text: '' }, { title: 'Aviso dos', text: '' }],
    phrases: ['Frase del local'], showPhraseAfterMessages: true,
  } }, 'PUT')
  const { lastInsertRowid } = db.prepare(`INSERT INTO users(username,password,name,roleId,avatarId) VALUES ('fixture-greeter','guest','Lucía',(SELECT roleId FROM roles WHERE name='guest'),'mujer/03')`).run()
  db.prepare('INSERT INTO greetings(queueId,roomId,userId,sender,message,createdAt,status) VALUES(1,1,?,?,?,1,?)')
    .run(lastInsertRowid, 'Lucía', '¡Feliz cumpleaños! Que esta canción nos recuerde todas las noches que compartimos bailando, cantando y riéndonos juntos. Hoy brindamos por todos los momentos que todavía nos quedan por celebrar.', 'DISPLAYED')
  await player.goto(`${uiBase}account?roomId=1&redirect=%2Fplayer`)
  await player.getByRole('button', { name: 'Tengo una cuenta', exact: true }).click()
  await player.getByPlaceholder('nombre de usuario o correo electrónico').fill('admin')
  await player.getByPlaceholder('contraseña', { exact: true }).fill('branding-test-password')
  await player.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  const play = player.getByRole('button', { name: 'Reproducir', exact: true }).last()
  await play.click()
  const banner = player.getByRole('region', { name: 'Comunicados del local' })
  const current = banner.locator('[aria-hidden="false"]')
  const avatar = banner.locator('[data-greeting-avatar]')
  const checkCenter = async () => {
    const bounds = await banner.boundingBox()
    const text = await current.locator('strong, p').first().boundingBox()
    expect(Math.abs(text.x + text.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1)
  }
  await expect(current).toContainText('De Lucía', { timeout: 30000 })
  await expect(avatar).toHaveAttribute('src', /\/assets\/avatars\/mujer\/03\.webp$/)
  await expect.poll(() => avatar.evaluate(img => img.naturalWidth)).toBe(160)
  await checkCenter()
  await banner.screenshot({ path: path.join(data, 'greeting-desktop.png') })
  for (const text of ['Aviso uno', 'Aviso dos', 'Frase del local']) {
    await expect(current).toHaveText(text, { timeout: 10000 })
    await expect(avatar).toHaveCount(0)
    await checkCenter()
  }
  await expect(current).toContainText('De Lucía', { timeout: 10000 })
  await emit('server/PLAYER_REQ_PAUSE')
  const video = player.locator('video:not([data-media-role="transition-background"])')
  await expect(video).toHaveJSProperty('paused', true)
  await expect(current).toContainText('De Lucía')
  await player.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await banner.boundingBox())?.width).toBeLessThan(390)
  await checkCenter()
  await banner.screenshot({ path: path.join(data, 'greeting-mobile.png') })
  await emit('server/GREETINGS', { operation: 'remove', greetingId: 1 })
  await expect(current).toHaveText('Aviso uno')
  await expect(avatar).toHaveCount(0)
  await expect(banner.getByText(/De Lucía/)).toHaveCount(0)
  await expect(video).toHaveJSProperty('paused', true)
  await expect.poll(() => db.prepare('SELECT status FROM greetings WHERE greetingId=1').get().status).toBe('DISPLAYED')
}
