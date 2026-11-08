import { createAction, createAsyncThunk, createReducer } from '@reduxjs/toolkit'
import type { AppThunk, RootState } from 'store/store'
import type { Path, Role } from 'shared/types'
import { defaultClientBranding, type ClientBranding } from 'shared/branding'
import { defaultPlayerDisplay, type PlayerDisplaySettings } from 'shared/playerDisplay'
import { defaultModeration, type ModerationSettings } from 'shared/textModeration'
import { defaultMusicBlocking, type MusicBlocking } from 'shared/musicBlocking'
import {
  PREFS_RECEIVE,
  PREFS_REQUEST,
  PREFS_SET,
  PREFS_PATH_UPDATE,
  PREFS_PATH_SET_PRIORITY,
  PREFS_PUSH,
  PREFS_REQ_SCANNER_START,
  PREFS_REQ_SCANNER_STOP,
  SCANNER_WORKER_STATUS,
  LOGOUT,
} from 'shared/actionTypes'

import HttpApi from 'lib/HttpApi'
const api = new HttpApi('prefs')

// ------------------------------------
// Actions
// ------------------------------------
const logout = createAction(LOGOUT)
export const setPref = createAction<{ key: string, data: unknown }>(PREFS_SET)
export const receivePrefs = createAction<object>(PREFS_RECEIVE)
export const setPathPriority = createAction<number[]>(PREFS_PATH_SET_PRIORITY)
const prefsPush = createAction<PrefsState>(PREFS_PUSH)
const scannerWorkerStatus = createAction<{ isScanning: boolean, pct: number, text: string }>(SCANNER_WORKER_STATUS)

export const setPathPrefs = createAsyncThunk(
  PREFS_PATH_UPDATE,
  async ({
    pathId,
    data,
  }: {
    pathId: number
    data: FormData
  }, thunkAPI) => {
    const response = await api.put(`/path/${pathId}`, {
      body: data,
    })

    thunkAPI.dispatch(receivePrefs(response))
  },
)

export const fetchPrefs = createAsyncThunk<object, void, { state: RootState }>(
  PREFS_REQUEST,
  async (_, thunkAPI) => {
    const response = await api.get('')

    // sign out if we see isFirstRun flag
    if (response.isFirstRun && thunkAPI.getState().user.userId !== null) {
      thunkAPI.dispatch(logout())
    }

    return response
  },
)

// The editor owns loading/errors; avoid a rejected action opening the global error dialog as well.
export const saveBranding = (branding: ClientBranding): AppThunk<Promise<ClientBranding>> => async (dispatch) => {
  const response = await api.put<{ branding: ClientBranding }>('/branding', { body: branding })
  dispatch(receivePrefs(response))
  return response.branding
}

export const saveModeration = (moderation: ModerationSettings): AppThunk<Promise<ModerationSettings>> => async (dispatch) => {
  const response = await api.put<{ moderation: ModerationSettings }>('/moderation', { body: moderation })
  dispatch(receivePrefs(response))
  return response.moderation
}

export const savePlayerDisplay = (playerDisplay: PlayerDisplaySettings): AppThunk<Promise<PlayerDisplaySettings>> => async (dispatch) => {
  const response = await api.put<{ playerDisplay: PlayerDisplaySettings }>('/player-display', { body: playerDisplay })
  dispatch(receivePrefs(response))
  return response.playerDisplay
}

export const saveMusicBlocking = (musicBlocking: MusicBlocking): AppThunk<Promise<MusicBlocking>> => async (dispatch) => {
  const response = await api.put<{ musicBlocking: MusicBlocking }>('/music-blocking', { body: musicBlocking })
  dispatch(receivePrefs(response))
  return response.musicBlocking
}

export const requestScan = createAsyncThunk(
  PREFS_REQ_SCANNER_START,
  async (pathId: number) => await api.get(`/path/${pathId}/scan`),
)

export const requestScanAll = createAsyncThunk(
  PREFS_REQ_SCANNER_START,
  async () => await api.get('/paths/scan'),
)

export const requestScanStop = createAsyncThunk(
  PREFS_REQ_SCANNER_STOP,
  async () => await api.get('/paths/scan/stop'),
)

// ------------------------------------
// Reducer
// ------------------------------------
export interface PrefsState {
  playerDisplay: PlayerDisplaySettings
  musicBlocking: MusicBlocking
  moderation: ModerationSettings
  branding: ClientBranding
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
  scannerPct: number
  scannerText: string
}

const initialState: PrefsState = {
  playerDisplay: defaultPlayerDisplay,
  musicBlocking: defaultMusicBlocking,
  moderation: { terms: [...defaultModeration.terms] },
  branding: { ...defaultClientBranding },
  isScanning: false,
  isReplayGainEnabled: false,
  paths: {
    result: [],
    entities: {},
  },
  roles: {
    result: [],
    entities: {},
  },
  scannerPct: 0,
  scannerText: '',
}

const prefsReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(fetchPrefs.fulfilled, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(receivePrefs, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(prefsPush, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(scannerWorkerStatus, (state, { payload }) => ({
      ...state,
      isScanning: payload.isScanning,
      scannerPct: payload.pct,
      scannerText: payload.text,
    }))
})

export default prefsReducer
