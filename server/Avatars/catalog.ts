import { avatarAsset, type AvatarEntry } from '../../shared/avatars.js'
import { db } from '../lib/Database.js'

type AvatarRow = Omit<AvatarEntry, 'active' | 'url'> & { active: number, revision: number }

export function catalogImageUrl ({ id, revision }: Pick<AvatarRow, 'id' | 'revision'>) {
  return revision ? `api/avatars/image?id=${encodeURIComponent(id)}&v=${revision}` : avatarAsset(id)
}

export function listAvatars (includeHidden = false): AvatarEntry[] {
  return db.all<AvatarRow>(`SELECT id, category, active, revision FROM guestAvatars ${includeHidden ? '' : 'WHERE active = 1'} ORDER BY rowid`)
    .map(row => ({ id: row.id, category: row.category, active: !!row.active, url: catalogImageUrl(row) }))
}

export function avatarUrl (value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const row = db.get<AvatarRow>('SELECT id, revision FROM guestAvatars WHERE id = ?', [value])
  return row && catalogImageUrl(row)
}

export function canChooseAvatar (value: unknown): value is string {
  return typeof value === 'string' && !!db.get('SELECT 1 FROM guestAvatars WHERE id = ? AND active = 1', [value])
}
