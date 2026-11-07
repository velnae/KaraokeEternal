import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { db } from '../lib/Database.js'
import Queue from '../Queue/Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { getSongSource } from '../SongSources/index.js'
import { getResolvedSongValidationError, type ResolvedSong } from '../../shared/songSource.js'
import type { PlaylistSnapshot, SavedPlaylist } from '../../shared/playlists.js'
import { QUEUE_PUSH } from '../../shared/actionTypes.js'
import getLogger from '../lib/Log.js'
import Prefs from '../Prefs/Prefs.js'
import { findMusicBlock } from '../../shared/musicBlocking.js'

interface PlaybackRow { roomId: number, playlistId: number | null, enabled: number, repeat: number, cursor: number, runId: string, actorId: number | null, message: string }
const log = getLogger('house-playlists')
const identifier = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('El identificador no es válido')
}
const listName = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Escriba un nombre de 1 a 80 caracteres')
  return value.trim()
}

export default class Playlists {
  static room (roomId: number) {
    identifier(roomId)
    if (!db.get('SELECT roomId FROM rooms WHERE roomId=?', [roomId])) throw new Error('La sala no existe')
  }

  static get (roomId: number, playlistId: number): SavedPlaylist {
    this.room(roomId)
    identifier(playlistId)
    const list = db.get<Omit<SavedPlaylist, 'items'>>('SELECT * FROM musicPlaylists WHERE roomId=? AND playlistId=?', [roomId, playlistId])
    if (!list) throw new Error('La lista no pertenece a esta sala')
    const rows = db.all<{ itemId: number, position: number, songJSON: string }>('SELECT itemId,position,songJSON FROM musicPlaylistItems WHERE playlistId=? ORDER BY position,itemId', [playlistId])
    return { ...list, items: rows.map(({ songJSON, ...row }) => ({ ...row, song: JSON.parse(songJSON) })) }
  }

  static snapshot (roomId: number): PlaylistSnapshot {
    this.room(roomId)
    const playlists = db.all<{ playlistId: number }>('SELECT playlistId FROM musicPlaylists WHERE roomId=? ORDER BY playlistId', [roomId]).map(row => this.get(roomId, row.playlistId))
    const state = db.get<PlaybackRow>('SELECT * FROM housePlayback WHERE roomId=?', [roomId])
    return { playlists, playback: { playlistId: state?.playlistId ?? null, enabled: !!state?.enabled, repeat: state ? !!state.repeat : true, skipped: state ? this.skipped(state) : [], message: state?.message || '' } }
  }

  static create (roomId: number, name: unknown) {
    this.room(roomId)
    if (db.get<{ count: number }>('SELECT count(*) count FROM musicPlaylists WHERE roomId=?', [roomId])!.count >= 50) throw new Error('La sala admite hasta 50 listas')
    return Number(db.run('INSERT INTO musicPlaylists(roomId,name) VALUES(?,?)', [roomId, listName(name)]).lastID)
  }

  static rename (roomId: number, playlistId: number, name: unknown) {
    this.get(roomId, playlistId)
    db.run('UPDATE musicPlaylists SET name=? WHERE playlistId=?', [listName(name), playlistId])
  }

  static createFromSongs (roomId: number, name: unknown, songs: ResolvedSong[]) {
    if (!songs.length) throw new Error('No hay canciones disponibles para crear la lista. Prueba con otro enlace.')
    db.exec('BEGIN IMMEDIATE')
    try {
      const playlistId = this.create(roomId, name)
      for (const song of songs) this.addResolved(roomId, playlistId, song)
      db.exec('COMMIT')
      return playlistId
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  static async add (roomId: number, playlistId: number, source: unknown, sourceId: unknown) {
    const list = this.get(roomId, playlistId)
    if (!['LOCAL', 'YOUTUBE'].includes(String(source)) || typeof sourceId !== 'string' || sourceId.length > 128) throw new Error('Seleccione una canción válida')
    if (list.items.some(item => item.song.source === source && item.song.sourceId === sourceId)) return
    const song = await getSongSource(source as 'LOCAL' | 'YOUTUBE').resolve(sourceId, { roomId })
    if (!song?.isPlayable) throw new Error('La canción no está disponible')
    this.addResolved(roomId, playlistId, song)
  }

  static addResolved (roomId: number, playlistId: number, song: ResolvedSong) {
    const list = this.get(roomId, playlistId)
    const error = getResolvedSongValidationError(song)
    if (error || !song.isPlayable) throw new Error(error || 'La canción no se puede reproducir')
    if (list.items.some(item => item.song.source === song.source && item.song.sourceId === song.sourceId)) return
    if (list.items.length >= 200) throw new Error('Cada lista admite hasta 200 canciones')
    db.run('INSERT INTO musicPlaylistItems(playlistId,position,source,sourceId,songJSON) VALUES(?,?,?,?,?)',
      [playlistId, (list.items.at(-1)?.position ?? 0) + 1, song.source, song.sourceId, JSON.stringify(song)])
  }

  static reorder (roomId: number, playlistId: number, order: unknown) {
    const list = this.get(roomId, playlistId)
    if (!Array.isArray(order) || order.length !== list.items.length || new Set(order).size !== order.length
      || !order.every(id => list.items.some(item => item.itemId === id))) throw new Error('La lista cambió. Actualice antes de ordenar')
    db.exec('BEGIN IMMEDIATE')
    try {
      order.forEach((id, index) => db.run('UPDATE musicPlaylistItems SET position=? WHERE itemId=?', [index + 1, id]))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  static removeItem (roomId: number, playlistId: number, itemId: number) {
    if (!this.get(roomId, playlistId).items.some(item => item.itemId === itemId)) throw new Error('La canción no pertenece a esta lista')
    this.clearPending(roomId, itemId)
    db.run('DELETE FROM musicPlaylistItems WHERE itemId=?', [itemId])
  }

  static remove (roomId: number, playlistId: number) {
    this.get(roomId, playlistId)
    const state = db.get<PlaybackRow>('SELECT * FROM housePlayback WHERE roomId=?', [roomId])
    if (state?.playlistId === playlistId) {
      this.clearPending(roomId)
      db.run('UPDATE housePlayback SET playlistId=NULL,enabled=0,message=? WHERE roomId=?', ['Seleccione otra lista para continuar.', roomId])
    }
    db.run('DELETE FROM musicPlaylistItems WHERE playlistId=?', [playlistId])
    db.run('DELETE FROM musicPlaylists WHERE playlistId=?', [playlistId])
  }

  static configure (roomId: number, actorId: number, input: { playlistId?: unknown, enabled?: unknown, repeat?: unknown, restart?: unknown }) {
    this.room(roomId)
    if (typeof input.enabled !== 'boolean' || typeof input.repeat !== 'boolean' || (input.restart !== undefined && typeof input.restart !== 'boolean')) throw new Error('Configuración de reproducción no válida')
    const playlistId = input.playlistId === null ? null : Number(input.playlistId)
    const list = playlistId === null ? null : this.get(roomId, playlistId)
    if (input.enabled && !list?.items.length) throw new Error('Agregue canciones a una lista antes de activarla')
    const previous = db.get<PlaybackRow>('SELECT * FROM housePlayback WHERE roomId=?', [roomId])
    const reset = !previous || previous.playlistId !== playlistId || input.restart === true
    let cursor = reset ? 0 : previous.cursor
    if (!reset && (!input.enabled || Number(input.repeat) !== previous.repeat)) {
      cursor = this.playedCursor(roomId, previous.runId)
    }
    if (reset || !input.enabled || Number(input.repeat) !== previous.repeat) this.clearPending(roomId)
    db.run(`INSERT INTO housePlayback(roomId,playlistId,enabled,repeat,cursor,runId,actorId,message) VALUES(?,?,?,?,?,?,?,'')
      ON CONFLICT(roomId) DO UPDATE SET playlistId=excluded.playlistId,enabled=excluded.enabled,repeat=excluded.repeat,
      cursor=excluded.cursor,runId=excluded.runId,actorId=excluded.actorId,message=''`,
    [roomId, playlistId, Number(input.enabled), Number(input.repeat), cursor, reset ? randomUUID() : previous.runId, actorId])
  }

  private static playedCursor (roomId: number, runId: string, currentQueueId = -1) {
    return db.get<{ position: number }>(`SELECT i.position FROM queue q JOIN musicPlaylistItems i ON i.itemId=q.playlistItemId
      WHERE q.roomId=? AND q.houseRunId=? AND (q.status IN ('PLAYING','PLAYED','FAILED') OR q.queueId=?) ORDER BY q.queueId DESC LIMIT 1`,
    [roomId, runId, currentQueueId])?.position ?? 0
  }

  // Called inside the queue-cleanup transaction; the caller removes pending rows.
  static suspendForQueueCleanup (roomId: number, currentQueueId: number): boolean {
    const state = db.get<PlaybackRow>('SELECT * FROM housePlayback WHERE roomId=?', [roomId])
    if (!state?.enabled) return false
    db.run('UPDATE housePlayback SET enabled=0,cursor=?,message=? WHERE roomId=?',
      [this.playedCursor(roomId, state.runId, currentQueueId), 'Lista desactivada al vaciar la cola.', roomId])
    return true
  }

  private static clearPending (roomId: number, itemId?: number) {
    const rows = db.all<{ queueId: number }>(`SELECT queueId FROM queue WHERE roomId=? AND houseRunId IS NOT NULL AND status='APPROVED'${itemId === undefined ? '' : ' AND playlistItemId=?'}`, itemId === undefined ? [roomId] : [roomId, itemId])
    for (const row of rows) Queue.remove(row.queueId, roomId)
    return rows.length > 0
  }

  private static skipped (state: PlaybackRow): number[] {
    return db.all<{ playlistItemId: number }>('SELECT DISTINCT playlistItemId FROM queue WHERE roomId=? AND houseRunId=? AND status=\'FAILED\' AND playlistItemId IS NOT NULL', [state.roomId, state.runId]).map(row => row.playlistItemId)
  }

  static reconcile (roomId: number): boolean {
    const state = db.get<PlaybackRow>('SELECT * FROM housePlayback WHERE roomId=?', [roomId])
    if (!state?.enabled || !state.playlistId) return false
    const room = Rooms.get(roomId, { status: ['open', 'closed'] }).entities[roomId]
    if (room?.status !== 'open') return false
    if (!state.actorId) {
      db.run('UPDATE housePlayback SET enabled=0,message=? WHERE roomId=?', ['Un administrador debe volver a activar la lista.', roomId])
      return this.clearPending(roomId)
    }
    const list = this.get(roomId, state.playlistId)
    const failed = this.skipped(state)
    let changed = false
    for (const id of failed) changed = this.clearPending(roomId, id) || changed
    const musicBlocking = Prefs.getMusicBlocking()
    const blocked = list.items.filter(item => findMusicBlock(item.song, musicBlocking))
    const available = list.items.filter(item => !failed.includes(item.itemId) && !blocked.includes(item))
    if (!available.length) {
      db.run('UPDATE housePlayback SET message=? WHERE roomId=?', [blocked.length ? 'No hay canciones disponibles: revise Música bloqueada y los errores de la lista.' : list.items.length ? 'Todas las canciones fallaron. Revise la lista y pulse Reiniciar lista para reintentarlas.' : 'La lista está vacía. Agregue canciones desde Biblioteca.', roomId])
      return changed
    }
    // Prepare a complete cycle independently of interleaving; wrap only after
    // its prepared songs have been consumed, never on each timer/status tick.
    db.exec('BEGIN IMMEDIATE')
    try {
      const prepared = new Set(db.all<{ playlistItemId: number }>('SELECT playlistItemId FROM queue WHERE roomId=? AND houseRunId=? AND status=\'APPROVED\'', [roomId, state.runId]).map(row => row.playlistItemId))
      let cursor = state.cursor
      let message = failed.length ? `${failed.length} canciones omitidas por error. Reinicie la lista para reintentarlas.` : ''
      if (blocked.length) message += ` ${blocked.length} canciones omitidas por la política de contenido del local.`
      if (state.repeat && prepared.size === 0 && !available.some(item => item.position > cursor)) cursor = 0
      for (const item of available) {
        if (item.position <= cursor || prepared.has(item.itemId)) continue
        Queue.add({ roomId, userId: state.actorId, song: item.song, origin: 'HOUSE', requestId: randomUUID(), playlistItemId: item.itemId, houseRunId: state.runId })
        prepared.add(item.itemId)
        cursor = item.position
        changed = true
      }
      if (!state.repeat && prepared.size === 0) {
        message = 'Lista preparada hasta el final. Active Repetir o pulse Reiniciar lista para volver a usarla.'
      }
      if (cursor !== state.cursor || message !== state.message) {
        db.run('UPDATE housePlayback SET cursor=?,message=? WHERE roomId=?', [cursor, message, roomId])
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return changed
  }
}

export function publishHouseQueue (io: Server, roomId: number) {
  Playlists.reconcile(roomId)
  io.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
}

export function startHousePlaylists (io: Server) {
  const tick = () => {
    for (const { roomId } of db.all<{ roomId: number }>('SELECT roomId FROM housePlayback WHERE enabled=1')) {
      try {
        if (Playlists.reconcile(roomId)) io.to(Rooms.prefix(roomId)).emit('action', { type: QUEUE_PUSH, payload: Queue.get(roomId) })
      } catch (error) {
        log.error('House playlist room %s: %s', roomId, (error as Error).message)
        db.run('UPDATE housePlayback SET enabled=0,message=? WHERE roomId=?', ['No se pudo preparar la lista. Actualice y vuelva a activarla.', roomId])
      }
    }
  }
  tick()
  const timer = setInterval(tick, 1000)
  return () => clearInterval(timer)
}
