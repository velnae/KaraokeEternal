import { expect, it, vi } from 'vitest'
import { createTurnDirector } from './turnDirector'
import { reduceTurn } from './turnDirector'
import { planNormalTurn } from './turnPlan'

const plan = planNormalTurn({ source: 1, replayKey: 0, epoch: 2, roomId: 1, boundary: 'ended', held: null, announce: true,
  queue: { result: [2], entities: { 2: { queueId: 2, status: 'APPROVED', origin: 'HOUSE' } } }, backdrop: true, animator: true, ambience: true, greetings: false })

function fixture () {
  let now = 0
  let timeout = () => {}
  const commands: string[] = []
  const release = vi.fn()
  const disarm = vi.fn()
  const director = createTurnDirector({ now: () => now, serverNow: () => 10000 + now,
    schedule: (_, callback) => {
      timeout = callback
      return disarm
    },
    execute: cmd => commands.push(cmd.type), release })
  const run = director.begin(plan, 1000)
  const boundary = () => {
    run.report({ type: 'ended' })
    run.report({ type: 'ended' })
    run.report({ type: 'intro-ended' })
  }
  const advance = () => {
    now += 1001
  }
  return { commands, release, disarm, director, run, boundary, expire: () => timeout(), advance }
}

const permit = { type: 'permit', identity: plan.identity, id: 'grant', startBefore: 11000, start: 'unused' } as const
it.each([true, false])('listening presentation handled=%s gates the generic announcement', (handled) => {
  const request = planNormalTurn({ source: 1, replayKey: 0, roomId: 1, epoch: 2, boundary: 'ended', announce: true, held: null,
    queue: { result: [2], entities: { 2: { queueId: 2, origin: 'PARTICIPANT', requestIntent: 'LISTEN', status: 'APPROVED' } } },
    listeningPresentations: true, animator: true, greetings: true, backdrop: true, ambience: true })
  expect(request.kind).toBe('listening')
  const presenting = reduceTurn(request, 'intro', { type: 'intro-ended' }, 100)
  expect(presenting.commands).toEqual([{ type: 'present-request' }])
  const decision = reduceTurn(request, presenting.phase, { type: 'presentation', handled }, 101)
  expect(decision.commands).toEqual([{ type: handled ? 'start-song' : 'reserve' }])
  expect(reduceTurn(request, decision.phase, { type: 'presentation', handled }, 102).commands).toEqual([])
})
it('recovers one permit, advances once, and exits only on real playing', () => {
  const { commands, release, disarm, director, run, boundary } = fixture()
  expect(director.begin(plan, 1000)).toBe(run)
  boundary()
  run.report({ type: 'unanswered' })
  run.report({ type: 'unanswered' })
  run.report({ ...permit, identity: 'old-epoch' })
  run.report(permit)
  run.report(permit)
  run.report({ type: 'playing' })
  run.report({ type: 'voice-ended' })
  run.report({ type: 'curtain-ended' })
  run.report({ type: 'curtain-ended' })
  expect(commands).toEqual(['prepare-backdrop', 'start-bed', 'intro', 'reserve', 'lookup', 'play-voice', 'finish-curtain', 'start-song'])
  run.report({ type: 'playing' })
  expect(commands[commands.length - 1]).toBe('exit-on-playing')
  run.report({ type: 'exited' })
  run.report({ type: 'exited' })
  expect(release.mock.calls).toEqual([[plan, 'finished']])
  expect(disarm).toHaveBeenCalledOnce()
})

it.each(['pause', 'stop', 'skip', 'unmount', 'remote-close', 'disconnect', 'authority-lost'] as const)('invalidates callbacks before cleanup on %s', (reason) => {
  const { commands, release, director, run, boundary } = fixture()
  boundary()
  run.signal.addEventListener('abort', () => run.report(permit))
  director.cancel(reason)
  const replacement = director.begin(plan, 1000)
  run.report(permit)
  expect(commands).not.toContain('play-voice')
  expect(release.mock.calls).toEqual([[plan, reason]])
  expect(replacement.signal.aborted).toBe(false)
})

it('does not replay a voice when recovery cannot prove it was unused', () => {
  const { run, boundary, release, commands } = fixture()
  boundary()
  run.report({ type: 'unanswered' })
  run.report({ ...permit, start: 'uncertain' })
  expect(commands).not.toContain('play-voice')
  expect(release.mock.calls).toEqual([[plan, 'uncertain-start']])
})

it('rejects an expired grant against server time, without blocking the song', () => {
  const { run, boundary, commands } = fixture()
  boundary()
  run.report({ ...permit, startBefore: 9999 })
  expect(commands[commands.length - 1]).toBe('start-song')
  expect(commands).not.toContain('play-voice')
})

it('enforces the monotonic deadline even when the timer fires late', () => {
  const { boundary, run, commands, advance, expire, release } = fixture()
  boundary()
  advance()
  run.report(permit)
  expire()
  expect(commands).not.toContain('play-voice')
  expect(release.mock.calls).toEqual([[plan, 'deadline']])
})
