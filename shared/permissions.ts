export const userRoles = ['admin', 'operator', 'manager', 'standard', 'guest', 'player'] as const
export type UserRole = typeof userRoles[number]
export type Permission = 'operate' | 'personalize' | 'admin'
export type AccessIdentity = { role?: string | null, isAdmin?: boolean }

export const roleLabels: Record<UserRole, string> = {
  admin: 'Administrador', operator: 'Operador', manager: 'Encargado del local',
  standard: 'Usuario estándar', guest: 'Invitado', player: 'Reproductor (reservado)',
}

const permissions: Record<UserRole, readonly Permission[]> = {
  admin: ['operate', 'personalize', 'admin'],
  operator: ['operate'], manager: ['operate', 'personalize'],
  standard: [], guest: [], player: [],
}

export function hasPermission (identity: AccessIdentity | null | undefined, permission: Permission): boolean {
  // Legacy client state and isolated handler fixtures may not contain a role yet.
  const role = identity?.role ?? (identity?.isAdmin ? 'admin' : '')
  return Object.prototype.hasOwnProperty.call(permissions, role) && permissions[role as UserRole].includes(permission)
}

export const canOperate = (identity: AccessIdentity | null | undefined) => hasPermission(identity, 'operate')
export const canPersonalize = (identity: AccessIdentity | null | undefined) => hasPermission(identity, 'personalize')
