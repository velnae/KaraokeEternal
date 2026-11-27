import { expect, it } from 'vitest'
import { compareTurnSelection, planNormalTurn, type TurnInputs } from './turnPlan'

const track = (queueId: number, status = 'APPROVED', origin = 'HOUSE') => ({ queueId, origin, status })
const base: TurnInputs = { source: 7, replayKey: 0, epoch: 3, roomId: 1, announce: true, boundary: 'ended', held: null,
  animator: true, ambience: true, greetings: false, backdrop: true,
  queue: { result: Object.freeze([7, 12, 10]), entities: { 7: track(7, 'PLAYED'), 10: track(10), 12: track(12) } } }

it('preserves scheduler order at natural end without sorting by queue ID', () => {
  const plan = planNormalTurn(base)
  expect(plan.destination).toBe(12)
  expect(plan.steps).toEqual(['prepare-backdrop', 'start-eligible-bed', 'attempt-voice', 'finish-eligible-curtain', 'start-song', 'exit-on-playing'])
  expect(compareTurnSelection(plan, 10, true)).toBe('destination-mismatch')
  expect(compareTurnSelection(plan, 12, false)).toBe('scene-eligibility-mismatch')
})

it('replans a newly approved request but preserves a held approved turn', () => {
  const queue = { result: [7, 14, 12], entities: { ...base.queue.entities, 14: track(14, 'APPROVED', 'PARTICIPANT') } }
  const update = planNormalTurn({ ...base, queue })
  expect(update).toMatchObject({ destination: 14, kind: 'normal' })
  expect(update.steps).toContain('present-request')
  expect(update.identity).not.toBe(planNormalTurn(base).identity)
  expect(planNormalTurn({ ...base, queue, held: track(12) }).destination).toBe(12)
  expect(planNormalTurn({ ...base, queue, held: track(12, 'REMOVED') }).destination).toBe(14)
})

it('replay, epoch and room distinguish executions even with identical queue entries', () => {
  const plans = [base, { ...base, replayKey: 100 }, { ...base, epoch: 4 }, { ...base, roomId: 2 }].map(planNormalTurn)
  expect(new Set(plans.map(p => p.identity)).size).toBe(4)
  expect(plans.every(p => p.destination === 12)).toBe(true)
})

it('skips unapproved entries and treats exhaustion as selection only', () => {
  const plan = planNormalTurn({ ...base, queue: { result: [7, 8], entities: { 8: track(8, 'PENDING_APPROVAL') } } })
  expect(plan.steps).toEqual([])
  expect(compareTurnSelection(plan, null, false)).toBe('selection-only')
})

it('a direct advance without announcement has only a song step; muted ambience has no bed step', () => {
  expect(planNormalTurn({ ...base, announce: false }).steps).toEqual(['start-song'])
  expect(planNormalTurn({ ...base, ambience: false }).steps).not.toContain('start-eligible-bed')
})
