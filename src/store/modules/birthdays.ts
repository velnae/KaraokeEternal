import { BIRTHDAY_STATE, type BirthdaySnapshot } from 'shared/birthdays'
import type { RootState } from '../store'

const initial: BirthdaySnapshot = { roomId: -1, events: [] }
export default function birthdays (state = initial, action: { type: string, payload?: BirthdaySnapshot }) {
  return action.type === BIRTHDAY_STATE && action.payload ? action.payload : state
}
export const selectBirthdays = (state: RootState) => state.birthdays.roomId === state.user.roomId ? state.birthdays.events : empty
const empty: BirthdaySnapshot['events'] = []
