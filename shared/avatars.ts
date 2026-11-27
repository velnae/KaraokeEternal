export const defaultAvatar = 'general'
export type AvatarCategory = 'varon' | 'mujer'
export type AvatarEntry = { id: string, category: AvatarCategory | 'general', active: boolean, url: string }
export const AVATAR_UPLOAD_MAX = 2 * 1024 * 1024

export const avatarGroups = [
  { id: 'varon', label: 'Varón' },
  { id: 'mujer', label: 'Mujer' },
] as const

export const avatarAsset = (id: string) => `assets/avatars/${id}.webp`
