import { afterEach, beforeEach, expect, it } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import { refreshIdentity } from './identity.js'
import { canOperate } from '../../shared/permissions.js'

beforeEach(() => {
  open({ file: ':memory:', ro: false })
  db.run(`INSERT INTO users(userId,username,password,name,roleId) VALUES(1,'staff','unused','Staff',(SELECT roleId FROM roles WHERE name='admin'))`)
})
afterEach(() => close())

it('migrates existing roles without renumbering them and resolves legacy tokens', () => {
  expect(db.all('SELECT roleId,name FROM roles ORDER BY roleId')).toEqual([
    { roleId: 1, name: 'admin' }, { roleId: 2, name: 'player' }, { roleId: 3, name: 'standard' },
    { roleId: 4, name: 'guest' }, { roleId: 5, name: 'operator' }, { roleId: 6, name: 'manager' },
  ])
  expect(refreshIdentity({ userId: 1, isAdmin: false })).toMatchObject({ role: 'admin', isAdmin: true })
})

it('revokes stale token privileges on role change and account deletion', () => {
  const token = { userId: 1, role: 'admin', isAdmin: true }
  db.run(`UPDATE users SET roleId=(SELECT roleId FROM roles WHERE name='operator') WHERE userId=1`)
  const identity = refreshIdentity(token)
  expect(identity).toMatchObject({ role: 'operator', isAdmin: false, isGuest: false })
  expect(canOperate(identity)).toBe(true)
  db.run(`UPDATE users SET roleId=(SELECT roleId FROM roles WHERE name='standard') WHERE userId=1`)
  expect(canOperate(refreshIdentity(token))).toBe(false)
  db.run('DELETE FROM users WHERE userId=1')
  expect(() => refreshIdentity(token)).toThrow('cuenta')
  expect(() => refreshIdentity({ userId: undefined })).toThrow('Sesión')
})
