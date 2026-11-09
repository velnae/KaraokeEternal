import { createAction, createAsyncThunk, createReducer } from '@reduxjs/toolkit'
import HttpApi from 'lib/HttpApi'
import { User } from 'shared/types'
import type { UserGroup } from '../userGroups'
import {
  USERS_CREATE,
  USERS_EDITOR_CLOSE,
  USERS_EDITOR_OPEN,
  USERS_FILTER_ONLINE,
  USERS_FILTER_ROOM_ID,
  USERS_REMOVE,
  USERS_REQUEST,
  USERS_UPDATE,
  REDUX_SLICE_INJECT_NOOP,
} from 'shared/actionTypes'

const api = new HttpApi('')

export interface UserWithRoomsAndRole extends User {
  rooms: number[] // roomIds
  role: string
}

// ------------------------------------
// Actions
// ------------------------------------
export const fetchUsers = createAsyncThunk(
  USERS_REQUEST,
  async () => await api.get('users'),
)

export const createUser = createAsyncThunk(
  USERS_CREATE,
  async (data: FormData, thunkAPI) => {
    await api.post('user', {
      body: data,
    })

    thunkAPI.dispatch(fetchUsers())
  },
)

export const updateUser = createAsyncThunk(
  USERS_UPDATE,
  async ({
    userId,
    data,
  }: {
    userId: number
    data: FormData
  }, thunkAPI) => {
    await api.put(`user/${userId}`, {
      body: data,
    })

    thunkAPI.dispatch(fetchUsers())
  },
)

export const removeUser = createAsyncThunk(
  USERS_REMOVE,
  async (userId: number, thunkAPI) => {
    await api.delete(`user/${userId}`)

    thunkAPI.dispatch(fetchUsers())
  },
)

export const openUserEditor = createAction(USERS_EDITOR_OPEN)
export const closeUserEditor = createAction(USERS_EDITOR_CLOSE)
export const filterByOnline = createAction<boolean>(USERS_FILTER_ONLINE)
export const filterByRoom = createAction<number>(USERS_FILTER_ROOM_ID)
export const filterByGroup = createAction<UserGroup>('users/FILTER_GROUP')
export const searchUsers = createAction<string>('users/SEARCH')
export const clearUserFilters = createAction('users/CLEAR_FILTERS')

// ------------------------------------
// Reducer
// ------------------------------------
export interface UsersState {
  result: number[]
  entities: Record<number, UserWithRoomsAndRole>
  filterOnline: boolean
  filterRoomId: number | null
  filterGroup: UserGroup
  query: string
  isEditorOpen: boolean
}

const initialState: UsersState = {
  result: [],
  entities: {},
  filterOnline: false,
  filterRoomId: null,
  filterGroup: 'staff',
  query: '',
  isEditorOpen: false,
}

const usersReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(fetchUsers.fulfilled, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(createUser.fulfilled, (state) => {
      state.isEditorOpen = false
    })
    .addCase(updateUser.fulfilled, (state) => {
      state.isEditorOpen = false
    })
    .addCase(removeUser.fulfilled, (state) => {
      state.isEditorOpen = false
    })
    .addCase(openUserEditor, (state) => {
      state.isEditorOpen = true
    })
    .addCase(closeUserEditor, (state) => {
      state.isEditorOpen = false
    })
    .addCase(filterByGroup, (state, { payload }) => {
      state.filterGroup = payload
      state.filterOnline = payload === 'guests'
      state.filterRoomId = null
      state.query = ''
      state.isEditorOpen = false
    })
    .addCase(searchUsers, (state, { payload }) => {
      state.query = payload
    })
    .addCase(clearUserFilters, (state) => {
      state.query = ''
      state.filterOnline = false
      state.filterRoomId = null
    })
    .addCase(filterByOnline, (state, { payload }) => ({
      ...state,
      filterOnline: payload,
      filterRoomId: null,
    }))
    .addCase(filterByRoom, (state, { payload }) => ({
      ...state,
      filterOnline: false,
      filterRoomId: payload,
    }))
})

export default usersReducer

declare module 'store/reducers' {
  export interface LazyLoadedSlices {
    users: typeof initialState
  }
}

export const sliceInjectNoOp = createAction(REDUX_SLICE_INJECT_NOOP)
