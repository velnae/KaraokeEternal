export const TABLE_MODES = ['OFF', 'OPTIONAL', 'REQUIRED_QR'] as const
export type TableMode = typeof TABLE_MODES[number]
export const tableMode = (prefs?: { tables?: { mode?: string } }): TableMode =>
  TABLE_MODES.includes(prefs?.tables?.mode as TableMode) ? prefs.tables.mode as TableMode : 'OFF'

export interface RoomTable {
  tableId: number
  roomId: number
  code: string
  name: string
  status: 'active' | 'disabled' | 'archived'
  participants: number
  pending: number
}

export interface TableContext {
  participantSessionId: string | null
  tableId: number | null
  tableLabel: string | null
  expiresAt: number | null
}

export interface TableInvitation {
  roomId: number
  roomName: string
  tableId: number
  tableLabel: string
  hasPassword: boolean
}

export const TABLE_ACCESS_REQUIRED = 'TABLE_ACCESS_REQUIRED'
