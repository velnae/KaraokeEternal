import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite' // eslint-disable-line n/no-unsupported-features/node-builtins
import { describe, expect, it } from 'vitest'
import { validatePlayerDisplay } from '../../shared/playerDisplay.js'

const [up, down] = readFileSync(new URL('../lib/schemas/036-player-display.sql', import.meta.url), 'utf8').split('-- Down')
const brand = { name: 'Il Gatto', logoSrc: 'unchanged', supportUrl: '', player: {
  showLogo: true, showAnnouncements: true, alignment: 'center', backgroundColor: '#6b5143', messages: [{ title: 'QR de tu mesa', text: 'Pide tu canción' }],
} }

describe('player display data migration', () => {
  it.each([false, true])('preserves identity and current settings; existing display wins=%s', (existing) => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE prefs(key TEXT PRIMARY KEY, data TEXT)')
      db.prepare('INSERT INTO prefs VALUES(?,?)').run('branding', JSON.stringify(brand))
      const newer = validatePlayerDisplay({ logo: { enabled: true, scale: 150 }, announcement: { backgroundColor: '#123456' } })
      if (existing) db.prepare('INSERT INTO prefs VALUES(?,?)').run('playerDisplay', JSON.stringify(newer))
      const value = (key: string) => JSON.parse(db.prepare('SELECT data FROM prefs WHERE key=?').get(key)!.data as string)
      db.exec(`BEGIN; ${up} COMMIT;`)
      const display = validatePlayerDisplay(value('playerDisplay'))
      if (existing) expect(display).toEqual(newer)
      else {
        expect(display.logo.enabled).toBe(true)
        expect(display.announcement).toMatchObject({ enabled: true, alignment: 'center', backgroundColor: '#6b5143', messages: brand.player.messages })
      }
      expect(value('branding')).toEqual({ name: brand.name, logoSrc: brand.logoSrc, supportUrl: '' })
      db.exec(up)
      expect(validatePlayerDisplay(value('playerDisplay'))).toEqual(display)
      db.exec(down)
      expect(value('branding').player.showLogo).toBe(true)
      db.exec(up)
      expect(validatePlayerDisplay(value('playerDisplay'))).toEqual(display)
    } finally { db.close() }
  })
})
