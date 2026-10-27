import type { ResolvedSong } from './songSource.js'

export interface PlaylistItem { itemId: number, position: number, song: ResolvedSong }
export interface SavedPlaylist { playlistId: number, roomId: number, name: string, items: PlaylistItem[] }
export interface HousePlayback { playlistId: number | null, enabled: boolean, repeat: boolean, skipped: number[], message: string }
export interface PlaylistSnapshot { playlists: SavedPlaylist[], playback: HousePlayback }
