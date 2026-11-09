import { describe, expect, it } from 'vitest'
import { canOperate, canPersonalize, hasPermission, userRoles } from './permissions.js'

describe('staff access', () => {
  it.each(userRoles)('keeps the approved access boundary for %s', (role) => {
    const identity = { role, isAdmin: false }
    expect(canOperate(identity)).toBe(['admin', 'operator', 'manager'].includes(role))
    expect(canPersonalize(identity)).toBe(['admin', 'manager'].includes(role))
    expect(hasPermission(identity, 'admin')).toBe(role === 'admin')
  })

  it('does not trust a legacy admin flag when an explicit limited role exists', () => {
    expect(hasPermission({ role: 'operator', isAdmin: true }, 'admin')).toBe(false)
    expect(canOperate({ role: 'player', isAdmin: true })).toBe(false)
    expect(canOperate({ role: 'toString' })).toBe(false)
    expect(canOperate(null)).toBe(false)
  })
})
