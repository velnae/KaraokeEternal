import React, { useState } from 'react'
import type { BirthdayPhase, PublicBirthday } from 'shared/birthdays'
import BirthdayPresentation from 'components/Birthdays/BirthdayPresentation'

export default function BirthdayScene ({ event, videoId, phase }: { event: PublicBirthday, videoId: string, phase?: BirthdayPhase }) {
  const [frame, setFrame] = useState<'loading' | 'ready' | 'failed'>('loading')
  const visible = !!phase && (frame === 'ready' || (frame === 'failed' && phase !== 'prelude'))
  return (
    <BirthdayPresentation
      name={event.name}
      video={{ id: videoId, url: `api/birthdays/assets/${videoId}` }}
      phase={phase ?? 'prelude'}
      playing={!!phase}
      staged={!visible}
      onVideoReady={() => setFrame('ready')}
      onVideoError={() => setFrame('failed')}
    />
  )
}
