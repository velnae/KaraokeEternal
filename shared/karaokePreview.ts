import type { CallJob, CallSnapshot } from './karaokeCalls.js'

export interface KaraokePreviewDraft {
  introId: string
  tableId: string
  performer: string
  song: string
  mode: 'hybrid' | 'reference'
  videoId: string
  bedId: string
  volume: number
}
export interface KaraokePreviewState {
  revision: number
  persisted: boolean
  recipeRevision: number
  draft: KaraokePreviewDraft
  samples: Record<string, CallJob>
}
export function validateKaraokePreviewDraft (value: unknown): KaraokePreviewDraft {
  const draft = value as KaraokePreviewDraft | null
  if (!draft || typeof draft.performer !== 'string' || draft.performer.length > 60 || typeof draft.song !== 'string' || draft.song.length > 140
    || !['hybrid', 'reference'].includes(draft.mode) || !Number.isFinite(draft.volume) || draft.volume < 0 || draft.volume > 1) throw new Error('Revise los datos de la prueba de karaoke.')
  for (const field of ['introId', 'tableId', 'videoId', 'bedId'] as const) {
    if (typeof draft[field] !== 'string' || (draft[field] !== '' && !/^[\w-]{1,100}$/.test(draft[field]))) throw new Error('Selección de prueba inválida.')
  }
  if (draft.tableId !== '' && (!Number.isSafeInteger(Number(draft.tableId)) || Number(draft.tableId) < 1)) throw new Error('Seleccione una mesa válida.')
  return { introId: draft.introId, tableId: draft.tableId, performer: draft.performer, song: draft.song, mode: draft.mode, videoId: draft.videoId, bedId: draft.bedId, volume: draft.volume }
}
export function karaokePreviewKey (draft: KaraokePreviewDraft, snapshot: Pick<CallSnapshot, 'intros' | 'tables'>, recipeRevision: number) {
  const intro = snapshot.intros.find(value => value.id === draft.introId)
  const table = snapshot.tables.find(value => String(value.tableId) === draft.tableId)
  const text = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ')
  return JSON.stringify([text(draft.performer), text(draft.song), draft.mode, intro?.id ?? draft.introId, intro?.profileKey ?? '',
    table?.tableId ?? draft.tableId, table?.part?.id ?? '', table?.revision ?? 0, table?.code ?? '', table?.spokenText ?? '', table?.outdated ?? true, recipeRevision])
}
