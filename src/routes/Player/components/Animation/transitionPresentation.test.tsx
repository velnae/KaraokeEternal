import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Greeting } from '../../../../../shared/greetings'
import type { OptimisticQueueItem, QueueItem } from '../../../../../shared/types'
import PlayerTransitionPresentation from './PlayerTransitionPresentation'
import { createTransitionPresentationSelector, transitionTrack, transitionTracks } from './transitionPresentation'

function track (queueId: number, patch: Partial<QueueItem> = {}): QueueItem {
  return {
    queueId, songId: 1, userId: 1, prevQueueId: null, mediaId: 1,
    rgTrackGain: null, rgTrackPeak: null, userDateUpdated: 0,
    userDisplayName: 'Ana', mediaType: 'mp4', isVideoKeyingEnabled: false,
    origin: 'PARTICIPANT', requestIntent: 'SING', source: 'LOCAL', status: 'APPROVED',
    externalId: null, title: `Canción ${queueId}`, artistOrChannel: 'Artista',
    durationSeconds: 180, thumbnailUrl: null, dateCreated: 0, dateUpdated: 0,
    tableLabelSnapshot: 'Mesa 07', ...patch,
  }
}

function ordered (...items: Array<QueueItem | OptimisticQueueItem>) {
  return { result: items.map(item => item.queueId), entities: Object.fromEntries(items.map(item => [item.queueId, item])) }
}

const position = (queueId: number) => ({ queueId, historyJSON: '[]', nextUserId: null as number | null, queueDecisionAt: 1 })
const preferences = { rotationMode: 'FAIR', maxSongsPerParticipantRound: 1, houseTracksBeforeParticipant: 0 }

describe('transition queue context', () => {
  it('reuses the projection across playback position updates but reacts to real queue changes', () => {
    const select = createTransitionPresentationSelector()
    const context = { queue: ordered(track(1), track(2)), player: { ...position(-1), position: 0 }, preferences, loading: false }
    const result = select(context)
    for (let i = 1; i <= 100; i++) {
      const progressed = { ...context, player: { ...context.player, position: i } }
      expect(select(progressed)).toBe(result)
    }
    expect(select.recomputations()).toBe(1)
    const changed = select({ ...context, queue: ordered(track(2), track(1)) })
    expect(changed.incoming.queueId).toBe(2)
    expect(select.recomputations()).toBe(2)
  })
  it('uses the supplied player order and skips unapproved, removed and optimistic requests', () => {
    const current = track(1, { status: 'PLAYING' })
    const first = track(8)
    const second = track(3)
    const queue = ordered(track(0, { status: 'PLAYED' }), current, track(2, { status: 'PENDING_APPROVAL' }),
      { queueId: -20, songId: 1, prevQueueId: 2, isOptimistic: true }, first, track(4, { status: 'REMOVED' }), second)
    expect(transitionTracks(queue, position(1), preferences)).toEqual({ incoming: first, following: second })
    expect(queue.result).toEqual([0, 1, 2, -20, 8, 4, 3])
  })

  it('keeps the incoming track during loading, before and after its playing acknowledgment', () => {
    for (const status of ['APPROVED', 'PLAYING'] as const) {
      const incoming = track(2, { status })
      const following = track(3)
      expect(transitionTracks(ordered(track(1, { status: 'PLAYED' }), incoming, following), position(2), preferences, true))
        .toEqual({ incoming, following })
    }
  })

  it('reflects queue reordering and removal without keeping an obsolete following track', () => {
    const first = track(2)
    const second = track(3)
    expect(transitionTracks(ordered(second, first), position(-1), preferences)).toEqual({ incoming: second, following: first })
    expect(transitionTracks(ordered(first, { ...second, status: 'REMOVED' }), position(-1), preferences)).toEqual({ incoming: first, following: undefined })
    expect(transitionTracks(ordered({ ...first, status: 'PLAYED' }), position(2), preferences)).toEqual({ incoming: undefined, following: undefined })
    expect(transitionTracks(ordered(), position(-1), preferences)).toEqual({ incoming: undefined, following: undefined })
  })

  it('forecasts house music after the final participant even when it is outside the current scheduled result', () => {
    const incoming = track(1)
    const following = track(2, { origin: 'HOUSE', requestIntent: 'LISTEN' })
    expect(transitionTracks(ordered(incoming, following), position(-1), preferences)).toEqual({ incoming, following })
  })

  it('respects house interleaving and participant fairness rather than insertion order', () => {
    const current = track(1, { status: 'PLAYED' })
    const returning = track(2)
    const house = track(3, { origin: 'HOUSE', requestIntent: 'LISTEN' })
    const newcomer = track(4, { userId: 2 })
    expect(transitionTracks(ordered(current, returning, house, newcomer), position(1), { ...preferences, houseTracksBeforeParticipant: 1 }))
      .toEqual({ incoming: house, following: newcomer })
  })
})

describe('track presentation contract', () => {
  it('uses intent and origin instead of guessing from a title or source', () => {
    expect(transitionTrack(track(1, { origin: 'HOUSE', requestIntent: 'SING' })).kind).toBe('house')
    expect(transitionTrack(track(1, { origin: 'OPERATOR', requestIntent: 'SING' })).kind).toBe('sing')
    expect(transitionTrack(track(1, { title: 'Karaoke 4K', requestIntent: 'LISTEN', source: 'YOUTUBE' })).kind).toBe('listen')
    expect(transitionTrack(track(1, { requestIntent: undefined })).kind).toBe('request')
  })

  it('does not present a YouTube channel as an artist or an operator as a house requester', () => {
    const item = transitionTrack(track(1, { origin: 'HOUSE', source: 'YOUTUBE', artistOrChannel: 'Canal de vídeos' }))
    expect(item).toMatchObject({ person: '', table: '', artist: '' })
    expect(transitionTrack(track(1, { origin: 'OPERATOR', requestIntent: 'UNKNOWN' })).person).toBe('')
  })

  it('omits absent data without inventing a table, performer or song title', () => {
    expect(transitionTrack(track(1, { userDisplayName: ' ', title: '', tableLabelSnapshot: null, artistOrChannel: '' })))
      .toMatchObject({ person: '', table: '', title: 'Próxima canción', artist: '' })
  })
})

const kinds = [
  { kind: 'sing', patch: { requestIntent: 'SING' } },
  { kind: 'listen', patch: { requestIntent: 'LISTEN' } },
  { kind: 'house', patch: { origin: 'HOUSE', requestIntent: 'LISTEN' } },
] as const

describe('public transition information', () => {
  for (const current of kinds) for (const next of kinds) {
    it(`presents ${current.kind} followed by ${next.kind}`, () => {
      const html = renderToStaticMarkup(
        <PlayerTransitionPresentation
          incoming={track(1, { title: 'Rayando el sol', ...current.patch })}
          following={track(2, { title: 'Vivir mi vida', userDisplayName: 'Luis', tableLabelSnapshot: 'Mesa 03', ...next.patch })}
          venueName='Il Gatto'
          greeting={null}
          onGreetingMounted={() => {}}
        />,
      )
      expect(html).toContain(`data-queue-id="1" data-kind="${current.kind}"`)
      expect(html).toContain(`data-queue-id="2" data-kind="${next.kind}"`)
      expect(html).toContain('Rayando el sol')
      expect(html).toContain('Vivir mi vida')
      expect(html).toContain('Después')
      if (current.kind === 'sing') expect(html).toContain('>Ana</h1>')
      else expect(html).toContain('>Rayando el sol</h1>')
      if (current.kind === 'listen') expect(html).toContain('Pedido de Ana')
      if (current.kind === 'house') {
        expect(html).toContain('Selección de la casa')
        expect(html).not.toContain('Ana')
      }
      expect(html.includes('Luis')).toBe(next.kind !== 'house')
    })
  }

  it('keeps an attributed greeting with track context, without requiring animator transcript text', () => {
    const greeting = { greetingId: 7, recipient: 'Carla', message: '¡Feliz cumpleaños!', sender: 'Ana' } as Greeting
    const html = renderToStaticMarkup(
      <PlayerTransitionPresentation
        incoming={track(1)}
        following={track(2)}
        venueName='Il Gatto'
        announcementActive
        greeting={greeting}
        onGreetingMounted={() => {}}
      />,
    )
    expect(html).toContain('data-greeting="true"')
    expect(html).toContain('data-greeting-id="7"')
    expect(html).toContain('¡Feliz cumpleaños!')
    expect(html).toContain('Para Carla')
    expect(html).toContain('De Ana')
    expect(html).toContain('Después')
    expect(html).toContain('announcement-overlay')
  })

  it('hides Después at queue end and retains useful information while an idle announcement plays', () => {
    const html = renderToStaticMarkup(<PlayerTransitionPresentation venueName='Il Gatto' announcementActive greeting={null} onGreetingMounted={() => {}} />)
    expect(html).not.toContain('transition-following')
    expect(html).toContain('Elige tu próxima canción')
    expect(html).toContain('announcement-overlay')
  })
})
