import type { QueuePrefs } from './queueRules.js'
import type { QueueItemOrigin, QueueItemStatus, SongSource } from './queueLifecycle.js'

export interface Artist {
  artistId: number
  name: string
  songIds: number[]
}

export interface Song {
  artistId: number
  duration: number
  songId: number
  title: string
  numMedia: number
}

export interface QueueItem {
  replacesQueueId?: number | null
  historyClearedAt?: number | null
  tableId?: number | null
  tableLabelSnapshot?: string | null
  queueId: number
  songId: number | null
  userId: number
  prevQueueId: number | null
  mediaId: number | null
  rgTrackGain: number | null
  rgTrackPeak: number | null
  userDateUpdated: number
  userDisplayName: string
  mediaType: 'cdg' | 'mp4' | 'youtube'
  isOptimistic?: false
  isVideoKeyingEnabled: boolean
  origin: QueueItemOrigin
  requestIntent?: import('./requestIntent.js').RequestIntent
  source: SongSource
  status: QueueItemStatus
  externalId: string | null
  title: string
  artistOrChannel: string
  durationSeconds: number | null
  thumbnailUrl: string | null
  dateCreated: number
  dateUpdated: number
}

export interface OptimisticQueueItem {
  isOptimistic: true
  prevQueueId: number
  queueId: number
  songId: number
}

export interface IRoomPrefs {
  animation?: import('./animation.js').AnimationPrefs
  transitionVideo?: import('./transitionVideo.js').TransitionVideoPrefs
  tables?: { mode: import('./tableAccess.js').TableMode }
  qr: {
    isEnabled: boolean
    opacity: number
    password: string
    size: number
  }
  user?: {
    isNewAllowed?: boolean
    isGuestAllowed?: boolean
  }
  roles?: Record<number, {
    allowNew: boolean
  }>
  queue?: QueuePrefs
}

export interface Room {
  roomId: number
  name: string
  status: 'open' | 'closed'
  dateCreated: number
  hasPassword: boolean
  numUsers: number
  prefs?: IRoomPrefs
}

export interface Role {
  roleId: number
  name: string
}

export interface Path {
  pathId: number
  path: string
  priority: number
  prefs: {
    isVideoKeyingEnabled: boolean
    isWatchingEnabled: boolean
  }
}

export interface User {
  userId: number
  username: string
  name: string
  isAdmin: boolean // todo: client and server ctx only
  isGuest: boolean // todo: client and server ctx only
  dateCreated: number
  dateUpdated: number
}

export interface UserWithRole extends User {
  role?: string
}

export interface PlaybackOptions {
  cdgAlpha?: number
  cdgSize?: number
  mp4Alpha?: number
  visualizer?: {
    sensitivity?: number
    isEnabled?: boolean
    nextPreset?: boolean
    prevPreset?: boolean
    randomPreset?: boolean
  }
}

export type MediaType = 'cdg' | 'mp4' | 'youtube' | ''

export interface Media {
  songId: number
  mediaId: number
  isPreferred: boolean
  path: string
  relPath: string
  duration: number
}

export interface Prefs {
  branding: import('./branding.js').ClientBranding
  isFirstRun?: boolean
  isScanning: boolean
  isReplayGainEnabled: boolean
  paths: {
    result: number[]
    entities: Record<number, Path>
  }
  roles: {
    result: number[]
    entities: Record<number, Role>
  }
  [key: string]: unknown
}
