import { expect, it, vi } from 'vitest'
import playerReducer from './player'
import statusReducer from '../../../store/modules/status'
import { PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_NEXT, PLAYER_CMD_REPLAY } from '../../../../shared/actionTypes'

vi.mock('../../../lib/getWebGLSupport', () => ({ default: () => false }))

it.each([true, false])('STOP clears media and queued playback intent even when isPlaying=%s', (isPlaying) => {
  const state = { ...playerReducer(undefined, { type: 'init' }), queueId: 12, historyJSON: '[1,2]', position: 42, isPlaying,
    _isPlayingNext: true, _isReplayingQueueId: 10, _isFetching: true, _isBetweenTracks: true, _isReplayPlayback: true, volume: 0.4 }
  const stopped = playerReducer(state, { type: PLAYER_CMD_STOP })
  expect(stopped).toMatchObject({ queueId: -1, historyJSON: '[]', position: 0, isPlaying: false, isAtQueueEnd: true,
    mediaType: null, _isPlayingNext: false, _isReplayingQueueId: null, _isFetching: false, _isBetweenTracks: false, _isReplayPlayback: false, _isQueueStopped: true, volume: 0.4 })
  const status = { ...statusReducer(undefined, { type: 'init' }), queueId: 12, isPlaying, position: 42, isPlayerPresent: true }
  expect(statusReducer(status, { type: PLAYER_CMD_STOP })).toMatchObject({ queueId: -1, isPlaying: false, position: 0, isAtQueueEnd: true, isPlayerPresent: true })
})

it.each([PLAYER_CMD_PLAY, PLAYER_CMD_NEXT, PLAYER_CMD_REPLAY])('allows explicit playback after a clear with %s', (type) => {
  const stopped = playerReducer(undefined, { type: PLAYER_CMD_STOP })
  expect(playerReducer(stopped, { type, payload: { queueId: 20 } })._isQueueStopped).toBe(false)
})
