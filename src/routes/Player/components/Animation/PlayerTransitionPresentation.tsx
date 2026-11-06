import React from 'react'
import type { QueueItem } from 'shared/types'
import type { Greeting } from 'shared/greetings'
import { transitionTrack } from './transitionPresentation'
import styles from './PlayerTransitionPresentation.css'

interface Props {
  incoming?: QueueItem
  following?: QueueItem
  venueName: string
  announcementActive?: boolean
  greetingIntro?: boolean
  greeting: Greeting | null
  onGreetingMounted: (node: HTMLElement | null) => void
  notice?: string
}

export default function PlayerTransitionPresentation ({ incoming, following, venueName, announcementActive, greetingIntro, greeting, onGreetingMounted, notice }: Props) {
  const current = incoming && transitionTrack(incoming)
  const next = following && transitionTrack(following)
  const brand = venueName.trim() || 'Il Gatto'
  const singer = current?.kind === 'sing'
  const headline = current ? singer && current.person ? current.person : current.title : 'Elige tu próxima canción'
  const attribution = current && !singer && [current.person && `Pedido de ${current.person}`, current.table].filter(Boolean).join(' · ')

  return (
    <section className={styles.presentation} data-testid='transition-presentation' data-greeting={!!greeting} aria-label='Presentación musical'>
      <div className={styles.foreground} data-testid={announcementActive ? 'announcement-overlay' : greetingIntro ? 'greeting-intro' : undefined}>
        <header className={styles.current} data-testid='transition-incoming' data-queue-id={incoming?.queueId} data-kind={current?.kind ?? 'empty'} role='status'>
          <p className={styles.label} data-neon={singer || current?.kind === 'house' || !current}>
            {current?.kind === 'house' || !current ? brand : current.label}
          </p>
          {singer && current.table && <p className={styles.table} translate='no'>{current.table}</p>}
          <h1 className={styles.headline} translate='no'>{headline}</h1>
          {singer && current.person && <p className={styles.song} translate='no'>{current.title}</p>}
          {current?.artist && <p className={styles.artist} translate='no'>{current.artist}</p>}
          {attribution && <p className={styles.attribution} translate='no'>{attribution}</p>}
          {current?.kind === 'house' && <p className={styles.attribution}>Selección de la casa</p>}
          {!current && <p className={styles.attribution}>Pide música o karaoke desde el QR de tu mesa.</p>}
        </header>
        {greeting && (
          <section key={greeting.greetingId} ref={onGreetingMounted} className={styles.greeting} role='status' data-testid='greeting-overlay' data-greeting-id={greeting.greetingId}>
            {greeting.recipient && <h2 translate='no'>{`Para ${greeting.recipient}`}</h2>}
            <p translate='no'>{greeting.message}</p>
            <footer translate='no'>{`De ${greeting.sender}`}</footer>
          </section>
        )}
        {notice && <p className={styles.notice}>{notice}</p>}
      </div>
      {next && (
        <aside className={styles.following} aria-label='Después' data-testid='transition-following' data-queue-id={following?.queueId} data-kind={next.kind}>
          <div className={styles.nextLabel}>
            <span>Después</span>
            <span>{next.label}</span>
          </div>
          <p className={styles.nextTitle} translate='no'>{next.title}</p>
          {(next.person || next.table) && <p className={styles.nextPerson} translate='no'>{[next.table, next.person].filter(Boolean).join(' · ')}</p>}
        </aside>
      )}
    </section>
  )
}
