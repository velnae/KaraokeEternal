import { createAction, createAsyncThunk, createReducer } from '@reduxjs/toolkit'
import { persistReducer } from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import socket from 'lib/socket'
import AppRouter from 'lib/AppRouter'
import { RootState } from 'store/store'
import HttpApi from 'lib/HttpApi'
import Persistor from 'store/Persistor'
import { fetchPrefs } from './prefs'
import { TABLE_ACCESS_REQUIRED } from 'shared/tableAccess'
import {
  ACCOUNT_RECEIVE,
  ACCOUNT_REQUEST,
  ACCOUNT_CREATE,
  ACCOUNT_UPDATE,
  LOGIN,
  LOGOUT,
  SOCKET_AUTH_ERROR,
  SOCKET_REQUEST_CONNECT,
} from 'shared/actionTypes'

const api = new HttpApi('')

const receiveAccount = createAction<object>(ACCOUNT_RECEIVE)

// ------------------------------------
// Login
// ------------------------------------
export const login = createAsyncThunk(
  LOGIN,
  async (creds: object, thunkAPI) => {
    // calls api endpoint that should set an httpOnly cookie with
    // our JWT, then establish the sockiet.io connection
    const user = await api.post('login', {
      body: creds,
    })
    sessionStorage.removeItem('tableInvitation')

    // signing in can cause additional reducers to be injected and
    // trigger rehydration with stale data, so purge here first
    await Persistor.get().purge()

    thunkAPI.dispatch(receiveAccount(user))
    thunkAPI.dispatch(fetchPrefs())
    thunkAPI.dispatch(connectSocket())
    socket.open()
    await Persistor.get().flush()

    // redirect in query string?
    const redirect = new URLSearchParams(window.location.search).get('redirect')

    if (redirect) {
      AppRouter.navigate(redirect)
    } else if (window.location.pathname.endsWith('/join')) {
      AppRouter.navigate('/library', { replace: true })
    }
  },
)

// ------------------------------------
// Logout
// ------------------------------------
const logout = createAction(LOGOUT)

export const requestLogout = createAsyncThunk(
  LOGOUT,
  async (_, thunkAPI) => {
    try {
      // server response should clear our cookie
      await api.get('logout')
    } catch {
      // ignore errors
    }

    thunkAPI.dispatch(logout())
    await Persistor.get().purge()
    socket.close()
  },
)

// ------------------------------------
// Create account
// ------------------------------------
export const createAccount = createAsyncThunk<void, FormData, { state: RootState }>(
  ACCOUNT_CREATE,
  async (data: FormData, thunkAPI) => {
    const isFirstRun = thunkAPI.getState().prefs.isFirstRun

    const user = await api.post(isFirstRun ? 'setup' : 'user', {
      body: data,
    })
    sessionStorage.removeItem('tableInvitation')

    // signing in can cause additional reducers to be injected and
    // trigger rehydration with stale data, so purge here first
    await Persistor.get().purge()

    thunkAPI.dispatch(receiveAccount(user))
    thunkAPI.dispatch(fetchPrefs())
    thunkAPI.dispatch(connectSocket())
    socket.open()
    await Persistor.get().flush()

    // redirect in query string?
    const redirect = new URLSearchParams(window.location.search).get('redirect')

    if (data.get('role') === 'guest') {
      AppRouter.navigate('/library')
    } else if (redirect) {
      AppRouter.navigate(redirect)
    } else if (window.location.pathname.endsWith('/join')) {
      AppRouter.navigate('/library', { replace: true })
    }
  },
)

// ------------------------------------
// Update account
// ------------------------------------
export const updateAccount = createAsyncThunk<void, FormData, { state: RootState }>(
  ACCOUNT_UPDATE,
  async (data: FormData, thunkAPI) => {
    const { userId } = thunkAPI.getState().user

    const user = await api.put(`user/${userId}`, {
      body: data,
    })

    thunkAPI.dispatch(receiveAccount(user))
    alert('La cuenta se actualizó correctamente.')
  },
)

// ------------------------------------
// Request account (does not refresh JWT)
// ------------------------------------
export const fetchAccount = createAsyncThunk<void, void, { state: RootState }>(
  ACCOUNT_REQUEST,
  async (_, thunkAPI) => {
    const identity = thunkAPI.getState().user
    try {
      const user = await api.get('user')
      // A delayed response must not replace a newer login or table transfer.
      if (thunkAPI.getState().user === identity) thunkAPI.dispatch(receiveAccount(user))
    } catch (error) {
      const status = (error as { status?: number }).status
      if ((status === 401 || status === 404) && thunkAPI.getState().user === identity) {
        socket.close()
        thunkAPI.dispatch(logout())
        await Persistor.get().purge()
      }
      // Keep the identity on transient network/server errors so reconnect can retry.
    }
  },
)

export const joinTable = createAsyncThunk(
  'user/JOIN_TABLE',
  async (body: { roomId: number, invitation?: string, roomPassword: string }, { dispatch }) => {
    socket.close()
    try {
      const user = await api.post('table-join', { body })
      dispatch(receiveAccount(user))
      await Persistor.get().flush()
      sessionStorage.removeItem('tableInvitation')
      await dispatch(connectSocket())
      socket.open()
      AppRouter.navigate('/library', { replace: true })
    } catch (error) {
      socket.open()
      throw error
    }
  },
)

// ------------------------------------
// Socket actions
// ------------------------------------
const requestSocketConnect = createAction<object>(SOCKET_REQUEST_CONNECT)

export const connectSocket = createAsyncThunk<void, void, { state: RootState }>(
  'user/SOCKET_CONNECT',
  async (_, { dispatch, getState }) => {
    const versions = {
      library: getState().library.version,
      stars: getState().starCounts.version,
    }

    dispatch(requestSocketConnect(versions))
    socket.io.opts.query = versions
  },
)

// ------------------------------------
// Reducer
// ------------------------------------
export interface UserState {
  participantSessionId: string | null
  tableId: number | null
  tableLabel: string | null
  expiresAt: number | null
  tableAccessError: string | null
  userId: number | null
  username: string | null
  name: string | null
  roomId: number | null
  isAdmin: boolean
  isGuest: boolean
  dateCreated: number
  dateUpdated: number
}

const initialState: UserState = {
  participantSessionId: null,
  tableId: null,
  tableLabel: null,
  expiresAt: null,
  tableAccessError: null,
  userId: null,
  username: null,
  name: null,
  roomId: null,
  isAdmin: false,
  isGuest: false,
  dateCreated: 0,
  dateUpdated: 0,
}

const userReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(receiveAccount, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(LOGOUT, () => ({
      ...initialState,
    }))
    .addCase(SOCKET_AUTH_ERROR, () => ({
      ...initialState,
    }))
    .addCase(createAction<string>(TABLE_ACCESS_REQUIRED), (state, action) => {
      state.tableAccessError = action.payload
      state.tableLabel = null
      state.tableId = null
    })
})

export default persistReducer({
  key: 'user',
  storage,
}, userReducer)
