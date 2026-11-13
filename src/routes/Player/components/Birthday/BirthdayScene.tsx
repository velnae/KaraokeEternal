import React from 'react'
import type { BirthdayGrant } from 'shared/birthdays'
import BirthdayPresentation from 'components/Birthdays/BirthdayPresentation'
import type SceneRun from '../Animation/SceneRun'

export default function BirthdayScene ({ grant, startedAt, mediaEndMs, run }: { grant: BirthdayGrant, startedAt?: number, mediaEndMs?: number, run?: SceneRun | null }) {
  const video = grant.assets.find(asset => asset.kind === 'video')
  return <BirthdayPresentation name={grant.event.name} video={video} scene={grant.scene} assets={grant.assets} startedAt={startedAt} mediaEndMs={mediaEndMs} resources={grant.resources} run={run} />
}
