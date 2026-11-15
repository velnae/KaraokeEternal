import { expect, it } from 'vitest'
import { birthdayTimeline, type BirthdayAsset } from './birthdays.js'

const assets: BirthdayAsset[] = (['intro', 'greeting', 'music', 'applause'] as const).map((kind, index) => ({ id: kind, kind, title: kind, durationMs: [1000, 12000, 15000, 3000][index], checksum: kind, url: `api/birthdays/assets/${kind}` }))

it('places the bed-only prelude, bridge and dedicated applause around the original three audio stages', () => {
  const steps = birthdayTimeline(assets, 1)
  expect(steps.map(step => [step.phase, step.durationMs])).toEqual([
    ['prelude', 2000], ['intro', 1000], ['greeting', 12000], ['bridge', 2500], ['music', 15000], ['applause', 3000],
  ])
  expect(steps.reduce((sum, step) => sum + step.durationMs, 0)).toBe(35500)
})

it('keeps historical snapshots on their original sequence and makes an unconfigured applause instantaneous', () => {
  expect(birthdayTimeline(assets).map(step => step.phase)).toEqual(['intro', 'greeting', 'music'])
  expect(birthdayTimeline(assets.slice(0, 3), 1).slice(-1)[0]).toEqual({ phase: 'applause', durationMs: 0, asset: undefined })
})
