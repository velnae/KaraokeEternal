import React, { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAppSelector } from 'store/hooks'
import AnimationPanel from 'components/Animation/AnimationPanel'
import CatalogProductionPanel from 'components/Animation/CatalogProductionPanel'
import AnimationQuickControls from 'components/Animation/AnimationQuickControls'
import { fetchAnimationClips } from 'lib/animationApi'
import styles from './Admin.css'

const areas = [['operation', 'Funcionamiento'], ['audio', 'Audios'], ['connection', 'Conexión y consumo']] as const
export default function AnimatorSettings () {
  const [params] = useSearchParams()
  const area = areas.some(([key]) => key === params.get('view')) ? params.get('view') : 'operation'
  const roomId = useAppSelector(state => state.user.roomId)
  const snapshot = useAppSelector(state => state.animation.snapshot?.roomId === state.user.roomId ? state.animation.snapshot : null)
  const [verified, setVerified] = useState(false)
  const [catalog, setCatalog] = useState<{ roomId: number, published: boolean } | null>(null)
  const published = catalog?.roomId === roomId && catalog.published
  useEffect(() => {
    let alive = true
    void fetchAnimationClips().then((clips): void => {
      if (alive) setCatalog({ roomId, published: clips.length > 0 })
      return undefined
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [roomId, snapshot?.catalogVersion])
  return (
    <>
      <section className={styles.checklist} aria-label='Preparación del animador'>
        <h2>Preparación de la sala</h2>
        <ol>
          <li data-complete={verified}><Link to='?view=connection'>{verified ? 'Conexión verificada' : 'Verificar conexión'}</Link></li>
          <li data-complete={published}><Link to='?view=audio'>{published ? 'Audio publicado' : 'Preparar y publicar un audio'}</Link></li>
          <li data-complete={!!snapshot?.audioUnlocked}><Link to='/player' target='_blank' rel='noopener'>{snapshot?.audioUnlocked ? 'Audio habilitado' : 'Habilitar audio en el reproductor'}</Link></li>
          <li data-complete={!!snapshot?.session}><Link to='?view=operation'>{snapshot?.session ? 'Jornada iniciada' : 'Iniciar jornada en modo automático'}</Link></li>
        </ol>
      </section>
      <nav className={styles.tabs} aria-label='Ajustes del animador'>
        {areas.map(([key, label]) => <Link key={key} to={`?view=${key}`} aria-current={area === key ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {area !== 'operation' && <AnimationQuickControls showLink={false} />}
      <div hidden={area !== 'operation'}><AnimationPanel /></div>
      <CatalogProductionPanel key={roomId} view={area === 'connection' ? 'connection' : area === 'audio' ? 'audio' : 'hidden'} onConnectionChange={setVerified} />
    </>
  )
}
