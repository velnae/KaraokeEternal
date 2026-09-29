import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration, formatSeconds, formatTime } from './dateTime'

describe('user-facing time formatting', () => {
  it('shows local time in 24-hour form without English AM/PM suffixes', () => {
    expect(formatTime(new Date(2024, 0, 1, 0, 7))).toBe('00:07')
    expect(formatTime(new Date(2024, 0, 1, 15, 4))).toBe('15:04')
    expect(formatDateTime(new Date(2024, 0, 1, 15, 4))).toMatch(/ 15:04$/)
  })

  it('keeps media durations and wait units unchanged', () => {
    expect(formatDuration(185)).toBe('3:05')
    expect(formatSeconds(125)).toBe('2m 5s')
  })
})
