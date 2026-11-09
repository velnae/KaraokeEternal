export const staffRoles = ['operator', 'manager', 'admin'] as const
export type UserGroup = 'staff' | 'registered' | 'guests' | 'system'
export const userGroupLabels: Record<UserGroup, string> = {
  staff: 'Personal', registered: 'Registrados', guests: 'Invitados', system: 'Sistema',
}

export function userGroup (role: string): UserGroup {
  if (staffRoles.some(value => value === role)) return 'staff'
  if (role === 'standard') return 'registered'
  if (role === 'guest') return 'guests'
  return 'system'
}

export const normalizeUserSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim()
