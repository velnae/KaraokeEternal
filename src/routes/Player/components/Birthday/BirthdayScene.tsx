import React from 'react'
import type { BirthdayGrant, BirthdayPhase } from 'shared/birthdays'
import BirthdayPresentation from 'components/Birthdays/BirthdayPresentation'

export default function BirthdayScene ({ grant, phase }: { grant: BirthdayGrant, phase: BirthdayPhase }) {
  const video = grant.assets.find(asset => asset.kind === 'video')
  return <BirthdayPresentation name={grant.event.name} video={video} phase={phase} />
}
