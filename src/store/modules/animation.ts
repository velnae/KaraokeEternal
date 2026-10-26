import { createAction, createReducer } from '@reduxjs/toolkit'
import { ANIMATION_STATE, ANIMATION_DISCONNECTED, type AnimationSnapshot } from 'shared/animation'
import { LOGOUT } from 'shared/actionTypes'

const initialState = { snapshot: null as AnimationSnapshot | null, receivedAt: 0, connected: false }
export default createReducer(initialState, builder => builder
  .addCase(createAction<AnimationSnapshot>(ANIMATION_STATE), (state, action) => {
    if (!action.payload) return
    state.snapshot = action.payload
    state.receivedAt = Date.now()
    state.connected = true
  })
  .addCase(createAction(ANIMATION_DISCONNECTED), (state) => { state.connected = false })
  .addCase(createAction(LOGOUT), () => initialState),
)
