import { describe, expect, it } from 'vitest'
import type { RootState } from 'store/store'
import usersReducer, { clearUserFilters, filterByGroup, filterByOnline, filterByRoom, searchUsers, type UsersState, type UserWithRoomsAndRole } from '../modules/users'
import getUsers from './getUsers'

const accounts: UserWithRoomsAndRole[] = [
  { userId: 1, name: 'Technical admin', username: 'admin', role: 'admin', rooms: [1] },
  { userId: 2, name: 'Operador de turno', username: 'operator', role: 'operator', rooms: [] },
  { userId: 3, name: 'María López', username: 'gerente@example.test', role: 'manager', rooms: [] },
  { userId: 4, name: 'Cantante registrado', username: 'singer', role: 'standard', rooms: [2] },
  { userId: 5, name: 'Invitado José', username: 'guest-abcd', role: 'guest', rooms: [2] },
  { userId: 6, name: 'Invitada Ana', username: 'guest-efgh', role: 'guest', rooms: [] },
  { userId: 7, name: 'Legacy screen', username: 'screen', role: 'player', rooms: [] },
  { userId: 8, name: 'Legacy account', username: 'legacy', role: 'unknown', rooms: [] },
].map(account => ({ ...account, isAdmin: account.role === 'admin', isGuest: account.role === 'guest', dateCreated: 1, dateUpdated: 1 }))

const initial = (): UsersState => ({
  ...usersReducer(undefined, { type: 'init' }),
  result: accounts.map(account => account.userId),
  entities: Object.fromEntries(accounts.map(account => [account.userId, account])),
})
const visible = (users: UsersState) => getUsers({ users } as RootState).result

describe('account group management', () => {
  it('starts with all staff, including disconnected operators and managers', () => {
    expect(visible(initial())).toEqual([1, 2, 3])
  })

  it('separates registered, guest and reserved accounts without dropping legacy roles', () => {
    expect(visible(usersReducer(initial(), filterByGroup('registered')))).toEqual([4])
    expect(visible(usersReducer(initial(), filterByGroup('guests')))).toEqual([5])
    expect(visible(usersReducer(initial(), filterByGroup('system')))).toEqual([7, 8])
  })

  it('searches names and usernames without accents or case, within the selected group', () => {
    expect(visible(usersReducer(initial(), searchUsers('  MARIA gerente  ')))).toEqual([3])
    expect(visible(usersReducer(initial(), searchUsers('singer')))).toEqual([])
    const guests = usersReducer(initial(), filterByGroup('guests'))
    expect(visible(usersReducer(guests, searchUsers('jose')))).toEqual([5])
  })

  it('combines presence, room and search and clears filters without mixing groups', () => {
    let state = usersReducer(initial(), filterByGroup('guests'))
    state = usersReducer(state, filterByRoom(2))
    state = usersReducer(state, searchUsers('ana'))
    expect(visible(state)).toEqual([])
    state = usersReducer(state, clearUserFilters())
    expect(visible(state)).toEqual([5, 6])
    expect(visible(usersReducer(state, filterByOnline(true)))).toEqual([5])
  })

  it('restores the appropriate default filter when switching account groups', () => {
    let state = usersReducer(initial(), filterByRoom(2))
    state = usersReducer(state, searchUsers('not found'))
    state = usersReducer(state, filterByGroup('registered'))
    expect(visible(state)).toEqual([4])
    state = usersReducer(state, filterByGroup('staff'))
    expect(visible(state)).toEqual([1, 2, 3])
  })
})
