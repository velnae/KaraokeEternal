import React from 'react'
import type { BirthdayGrant } from 'shared/birthdays'
import BirthdayPresentation from 'components/Birthdays/BirthdayPresentation'

export default function BirthdayScene ({ grant }: { grant: BirthdayGrant }) {
  const video = grant.assets.find(asset => asset.kind === 'video')
  return <BirthdayPresentation name={grant.event.name} video={video} />
}
