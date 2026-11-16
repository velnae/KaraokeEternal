import React, { useEffect, useLayoutEffect, useRef } from 'react'
import type { QueueItem } from 'shared/types'
import { isGreetingAllowed, type Greeting } from '../../../../../shared/greetings'
import { transitionTrack } from './transitionPresentation'
import styles from './PlayerTransitionPresentation.css'

const usePresentationLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

interface Props {
  incoming?: QueueItem
  following?: QueueItem
  upcoming?: QueueItem[]
  venueName: string
  announcementActive?: boolean
  greetingIntro?: boolean
  greeting: Greeting | null
  moderationTerms?: readonly string[]
  onGreetingMounted: (node: HTMLElement | null) => void
}

export default function PlayerTransitionPresentation ({ incoming, following, upcoming, venueName, announcementActive, greetingIntro, greeting, moderationTerms, onGreetingMounted }: Props) {
  if (greeting && !isGreetingAllowed(greeting, moderationTerms)) greeting = null
  const current = incoming && transitionTrack(incoming)
  const next = following && transitionTrack(following)
  const brand = venueName.trim() || 'Il Gatto'
  const singer = current?.kind === 'sing'
  const showTurns = singer && !!upcoming?.length
  const headline = current ? singer && current.person ? current.person : current.title : 'Elige tu próxima canción'
  const attribution = current && !singer && [current.person && `Pedido de ${current.person}`, current.table].filter(Boolean).join(' · ')
  const presentation = useRef<HTMLElement>(null)

  usePresentationLayoutEffect(() => {
    const root = presentation.current
    if (!root) return
    let disposed = false
    const fitTitles = () => {
      if (disposed) return
      const titles = Array.from(root.querySelectorAll<HTMLElement>('[data-transition-title="true"]'))
      const header = root.querySelector<HTMLElement>('header')
      const foreground = header?.parentElement
      const greeting = foreground?.querySelector<HTMLElement>('[data-testid="greeting-overlay"]')
      const participation = foreground?.querySelector<HTMLElement>('[data-karaoke-participation]')
      const secondary = greeting ?? participation
      const availableHeight = () => foreground
        ? foreground.clientHeight - (secondary ? secondary.getBoundingClientRect().height + parseFloat(getComputedStyle(foreground).rowGap) : 0)
        : Infinity
      const headerFits = () => !header || header.getBoundingClientRect().height <= availableHeight() + 1
      // Reset all titles first: prior fitting must not influence the space budget.
      for (const title of Array.from(root.querySelectorAll<HTMLElement>('[data-transition-title]'))) {
        title.style.removeProperty('font-size')
        title.style.removeProperty('-webkit-line-clamp')
      }
      // Fit the following block first; its final height determines the space
      // available for the current track and greeting above it.
      for (const title of titles.reverse()) {
        const isHeadline = title.tagName === 'H1'
        const isCurrent = header?.contains(title)
        if (isHeadline && !greeting) {
          title.style.webkitLineClamp = '3'
          if (!headerFits()) title.style.webkitLineClamp = '2'
        }
        const style = getComputedStyle(title)
        const base = parseFloat(style.fontSize)
        const minimum = Math.min(base, Math.max(parseFloat(style.getPropertyValue('--title-floor')), base * 0.7))
        const fits = () => title.scrollHeight <= title.clientHeight + 1
          && title.scrollWidth <= title.clientWidth + 1 && (!isCurrent || headerFits())
        if (fits()) continue
        // Search for the largest readable size, retaining the line clamp at the
        // minimum when even that cannot show the entire title.
        let low = minimum
        let high = base
        title.style.fontSize = `${minimum}px`
        if (fits()) {
          while (high - low > 0.25) {
            const middle = (low + high) / 2
            title.style.fontSize = `${middle}px`
            if (fits()) low = middle
            else high = middle
          }
        }
        title.style.fontSize = `${low}px`
      }
    }
    fitTitles()
    const observer = new ResizeObserver(fitTitles)
    observer.observe(root)
    void document.fonts.ready.then(fitTitles)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [headline, current?.title, next?.title, greeting?.message, greeting?.sender, singer, current?.person, current?.table, current?.artist, next?.person, next?.table, brand])

  return (
    <section ref={presentation} className={styles.presentation} data-testid='transition-presentation' data-greeting={!!greeting} data-karaoke={singer} aria-label='Presentación musical'>
      {singer && (
        <div className={styles.lights} aria-hidden='true'>
          <i />
          <i />
        </div>
      )}
      <div className={styles.foreground} data-testid={announcementActive ? 'announcement-overlay' : greetingIntro ? 'greeting-intro' : undefined}>
        <header className={styles.current} data-testid='transition-incoming' data-queue-id={incoming?.queueId} data-kind={current?.kind ?? 'empty'} role='status'>
          <p className={styles.label} data-neon={singer || current?.kind === 'house' || !current}>
            {current?.kind === 'house' || !current ? brand : current.label}
          </p>
          {singer && current.table && <p className={styles.table} translate='no'>{current.table}</p>}
          <h1 className={styles.headline} data-transition-title={!!current} translate='no'>{headline}</h1>
          {singer && current.person && <p className={styles.song} data-transition-title='true' translate='no'>{current.title}</p>}
          {current?.artist && <p className={styles.artist} translate='no'>{current.artist}</p>}
          {attribution && <p className={styles.attribution} translate='no'>{attribution}</p>}
          {current?.kind === 'house' && <p className={styles.attribution}>Selección de la casa</p>}
          {!current && <p className={styles.attribution}>Pide música o karaoke desde el QR de tu mesa.</p>}
        </header>
        {singer && !greeting && <p className={styles.participation} data-karaoke-participation aria-hidden='true'>Busca, elige y pide desde tu mesa</p>}
        {greeting && (
          <section key={greeting.greetingId} ref={onGreetingMounted} className={styles.greeting} role='status' data-testid='greeting-overlay' data-greeting-id={greeting.greetingId}>
            <p translate='no'>{greeting.message}</p>
            <footer translate='no'>{`De ${greeting.sender}`}</footer>
          </section>
        )}
      </div>
      {showTurns && (
        <aside className={styles.turns} aria-label='Próximos turnos'>
          <h2>Próximos turnos</h2>
          <ol>
            {upcoming.slice(0, 3).map((item) => {
              const track = transitionTrack(item)
              return (
                <li key={item.queueId} data-queue-id={item.queueId}>
                  <span className={styles.turnTable}>{track.table || '—'}</span>
                  <span className={styles.turnPerson} translate='no'>{track.person || track.label}</span>
                  <span className={styles.turnSong} translate='no'>
                    {track.title}
                    {track.kind === 'listen' && track.person && <small>Para escuchar</small>}
                  </span>
                </li>
              )
            })}
          </ol>
        </aside>
      )}
      {!showTurns && next && (
        <aside className={styles.following} aria-label='Después' data-testid='transition-following' data-queue-id={following?.queueId} data-kind={next.kind}>
          <div className={styles.nextLabel}>
            <span>Después</span>
            <span>{next.label}</span>
          </div>
          <p className={styles.nextTitle} data-transition-title='true' translate='no'>{next.title}</p>
          {(next.person || next.table) && <p className={styles.nextPerson} translate='no'>{[next.table, next.person].filter(Boolean).join(' · ')}</p>}
        </aside>
      )}
    </section>
  )
}
