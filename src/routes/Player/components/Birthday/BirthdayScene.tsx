import React, { useState } from 'react'
import type { BirthdayGrant } from 'shared/birthdays'
import { birthdayUrl } from 'components/Birthdays/api'
import styles from './BirthdayScene.css'

export default function BirthdayScene ({ grant }: { grant: BirthdayGrant }) {
  const [failed, setFailed] = useState(false)
  const video = grant.assets.find(asset => asset.kind === 'video')
  return (
    <section className={styles.scene} aria-label={`Cumpleaños de ${grant.event.name}`}>
      {video && !failed && <video muted autoPlay loop playsInline src={birthdayUrl(video.url)} onError={() => setFailed(true)} />}
      <div className={styles.recognition}>
        <p>¡Feliz cumpleaños!</p>
        <h1>{grant.event.name}</h1>
      </div>
    </section>
  )
}
