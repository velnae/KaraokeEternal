import { describe, expect, it } from 'vitest'
import { playerWindowResult } from './playerWindow.js'

describe('remote player window reply', () => {
  it('keeps only known results and a canonical player origin', () => {
    expect(playerWindowResult({ status: 'permission-required', origin: 'https://karaoke.puyu.pe', secret: 'discard' }))
      .toEqual({ status: 'permission-required', origin: 'https://karaoke.puyu.pe' })
    expect(playerWindowResult({ status: 'entered' })).toEqual({ status: 'entered' })
    expect(playerWindowResult({ status: 'closed' })).toEqual({ status: 'closed' })
  })

  it('rejects unknown statuses and origins containing paths or credentials', () => {
    for (const value of [null, true, { status: 'constructor' }, { status: 'success' },
      { status: 'entered', origin: 'https://user:password@example.com' },
      { status: 'entered', origin: 'https://example.com/player?token=private' },
      { status: 'entered', origin: 'javascript:alert(1)' }]) expect(playerWindowResult(value)).toBeNull()
  })
})
