import React, { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAppSelector } from 'store/hooks'
import HttpApi from 'lib/HttpApi'
import Button from 'components/Button/Button'
import { familyLabels, VOICE_FAMILIES, type AudioKind } from 'shared/animation'
import { resourceKindLabels, resourceStatus, type AudioResource, type ProviderCapabilities, type ResourcePage } from 'shared/audioCatalog'
import AudioResourceForm from './AudioResourceForm'
import AudioResourceDetails from './AudioResourceDetails'
import UrlTextInput from './UrlTextInput'
import styles from './AudioLibrary.css'

const api = new HttpApi('animation/')
function resourceQuery (search: string, kind: AudioKind) {
  const query = new URLSearchParams(search)
  query.set('kind', kind)
  for (const field of ['language', 'voiceName', 'style', 'origin', 'providerId', 'columns']) query.delete(field)
  return query.toString()
}
const columnLabels = { family: 'Uso', voiceName: 'Voz', category: 'Categoría', loop: 'Bucle' }
type Column = keyof typeof columnLabels
const columnsByKind: Record<AudioKind, Column[]> = { voice: ['family', 'voiceName'], effect: ['category'], ambience: ['category', 'loop'] }
const origin = (resource: AudioResource) => resource.metadata.providerId === 'elevenlabs' ? 'ElevenLabs' : resource.metadata.providerId || (resource.metadata.origin === 'uploaded' ? 'Archivo subido' : 'Incluido')
const characteristic = (resource: AudioResource, column: Column) => {
  const value = resource.metadata[column]
  if (column === 'family') return value === 'manual' ? 'Anuncio puntual' : familyLabels[value as keyof typeof familyLabels]
  if (column === 'loop') return value === undefined ? 'Sin especificar' : value ? 'Sí' : 'No'
  return String(value || 'Sin especificar')
}

export default function CatalogProductionPanel ({ visible }: { visible: boolean }) {
  const [params, setParams] = useSearchParams()
  const kind = (['voice', 'effect', 'ambience'].includes(params.get('kind') || '') ? params.get('kind') : 'voice') as AudioKind
  const roomId = useAppSelector(state => state.user.roomId)
  const [page, setPage] = useState<ResourcePage | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [providers, setProviders] = useState<ProviderCapabilities[]>([])
  const [processor, setProcessor] = useState<boolean | null>(null)
  const [form, setForm] = useState<'generate' | 'upload' | null>(null)
  const [details, setDetails] = useState<AudioResource | null>(null)
  const [source, setSource] = useState<AudioResource | undefined>(undefined)
  const [preview, setPreview] = useState<AudioResource | null>(null)
  const [highlight, setHighlight] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const queryString = resourceQuery(params.toString(), kind)
  useEffect(() => {
    if (!visible) return
    let alive = true
    let sequence = 0
    const load = () => {
      const current = ++sequence
      void api.get<ResourcePage>(`resources?${queryString}`).then((result): void => {
        if (alive && current === sequence) {
          setPage(result)
          setError('')
        }
        return undefined
      }).catch((error) => { if (alive && current === sequence) setError(error.message) })
    }
    load()
    const timer = setInterval(load, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [queryString, visible, roomId, refreshVersion])
  useEffect(() => {
    let alive = true
    void api.get<{ providers: ProviderCapabilities[], processorAvailable: boolean }>('providers').then((result): void => {
      if (alive) {
        setProviders(result.providers)
        setProcessor(result.processorAvailable)
      }
      return undefined
    }).catch((error) => { if (alive) setError(error.message) })
    return () => {
      alive = false
    }
  }, [roomId])
  useEffect(() => {
    const player = audio.current
    if (!visible) player?.pause()
    return () => {
      player?.pause()
    }
  }, [visible, preview?.id])
  const change = (field: string, value: string) => {
    const next = new URLSearchParams(params)
    if (field !== 'page') next.delete('resourceId')
    next.set(field, value)
    if (field !== 'page') next.set('page', '1')
    setParams(next, { replace: field === 'search' })
  }
  const typeLink = (type: AudioKind) => `?view=audio&kind=${type}`
  const columns = columnsByKind[kind]
  const fresh = () => {
    setDetails(null)
    setRefreshVersion(value => value + 1)
  }
  const saved = (id: string) => {
    setForm(null)
    setHighlight(id)
    setParams({ view: 'audio', kind, resourceId: id, state: 'all' })
    setRefreshVersion(value => value + 1)
  }
  return (
    <section hidden={!visible} className={styles.library} aria-label='Biblioteca de audios'>
      <nav className={styles.types} aria-label='Tipos de audio'>
        {(Object.keys(resourceKindLabels) as AudioKind[]).map(type => (
          <Link key={type} to={typeLink(type)} aria-label={`${resourceKindLabels[type]} (${page?.counts[type] ?? 0})`} aria-current={kind === type ? 'page' : undefined}>
            <span className={styles.fullTypeName}>{resourceKindLabels[type]}</span>
            <span className={styles.shortTypeName} aria-hidden='true'>{{ voice: 'Voces', effect: 'Efectos', ambience: 'Ambientes' }[type]}</span>
            {page ? ` (${page.counts[type]})` : ''}
          </Link>
        ))}
      </nav>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          Buscar audio
          <UrlTextInput type='search' value={params.get('search') || ''} onValueChange={value => change('search', value)} placeholder='Nombre o descripción' />
        </label>
        <label>
          Estado
          <select aria-label='Estado de audios' value={params.get('state') || ''} onChange={event => change('state', event.target.value)}>
            <option value=''>Sin archivar</option>
            <option value='active'>Activos</option>
            <option value='disabled'>Desactivados</option>
            <option value='archived'>Archivados</option>
            <option value='all'>Todos</option>
          </select>
        </label>
        <div className={styles.actions}>
          <Button
            variant='primary'
            disabled={processor === false}
            onClick={() => {
              setSource(undefined)
              setForm('generate')
            }}
          >
            Generar audio
          </Button>
          <Button
            className={styles.secondary}
            disabled={processor === false}
            onClick={() => {
              setSource(undefined)
              setForm('upload')
            }}
          >
            Subir audio
          </Button>
        </div>
      </div>
      {params.get('resourceId') && <p><Link to={typeLink(kind)}>Ver todos los audios</Link></p>}
      {processor === false && <p className={styles.notice}>No se pueden preparar audios. Revise FFmpeg y los permisos del servidor.</p>}
      <details className={styles.filters}>
        <summary>Filtros</summary>
        <div className={styles.fields}>
          {kind === 'voice'
            ? (
                <>
                  <label>
                    Uso
                    <select value={params.get('family') || ''} onChange={event => change('family', event.target.value)}>
                      <option value=''>Todos</option>
                      <option value='manual'>Anuncio puntual</option>
                      {VOICE_FAMILIES.map(value => <option key={value} value={value}>{familyLabels[value]}</option>)}
                    </select>
                  </label>
                </>
              )
            : (
                <label>
                  Categoría
                  <UrlTextInput value={params.get('category') || ''} onValueChange={value => change('category', value)} placeholder='Todas' />
                </label>
              )}
          {kind === 'ambience' && (
            <label>
              Bucle
              <select value={params.get('loop') || ''} onChange={event => change('loop', event.target.value)}>
                <option value=''>Todos</option>
                <option value='true'>Sí</option>
                <option value='false'>No</option>
              </select>
            </label>
          )}
          <label>
            Perfil
            <select value={params.get('profile') || ''} onChange={event => change('profile', event.target.value)}>
              <option value=''>Todos</option>
              <option value='dinner'>Cena</option>
              <option value='mixed'>Mixto</option>
              <option value='party'>Fiesta</option>
            </select>
          </label>
          <label>
            Ordenar por
            <select value={params.get('sort') || 'created'} onChange={event => change('sort', event.target.value)}>
              <option value='created'>Fecha</option>
              <option value='title'>Nombre</option>
              <option value='duration'>Duración</option>
              <option value='state'>Estado</option>
            </select>
          </label>
          <label>
            Orden
            <select value={params.get('direction') || 'desc'} onChange={event => change('direction', event.target.value)}>
              <option value='desc'>Descendente</option>
              <option value='asc'>Ascendente</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Link to={typeLink(kind)}>Limpiar filtros</Link>
        </div>
      </details>
      {error && (
        <p role='alert' className={styles.notice}>
          {error}
          {' '}
          <Button className={styles.secondary} onClick={() => setRefreshVersion(value => value + 1)}>Reintentar</Button>
        </p>
      )}
      {!page && !error && <p role='status'>Cargando audios…</p>}
      {notice && <p role='status' className={styles.help}>{notice}</p>}
      {page && !page.items.length && (
        <div className={styles.empty}>
          <h3>No hay audios en esta vista</h3>
          <p>Genere o suba un audio, o ajuste los filtros.</p>
          <Link to={typeLink(kind)}>Limpiar filtros</Link>
        </div>
      )}
      {!!page?.items.length && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                {columns.map(column => <th key={column} className={styles.detailColumn}>{columnLabels[column]}</th>)}
                <th className={styles.detailColumn}>Duración</th>
                <th className={styles.detailColumn}>Origen</th>
                <th>Estado</th>
                <th>Uso en sala</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(resource => (
                <tr key={resource.id} data-resource-id={resource.id} data-state={resource.preparation} aria-label={resource.title}>
                  <td className={styles.title}>
                    <strong>{resource.title}</strong>
                    <small className={styles.mobileSummary}>{[resource.durationMs ? `${(resource.durationMs / 1000).toFixed(1)} s` : '', ...columns.map(column => characteristic(resource, column)), origin(resource)].filter(Boolean).join(' · ')}</small>
                    {resource.id === highlight && <small>Última solicitud</small>}
                    {resource.error && <small className={styles.error}>{resource.error}</small>}
                  </td>
                  {columns.map(column => <td key={column} className={styles.detailColumn}>{characteristic(resource, column)}</td>)}
                  <td className={styles.detailColumn}>{resource.durationMs ? `${(resource.durationMs / 1000).toFixed(1)} s` : '—'}</td>
                  <td className={styles.detailColumn}>{origin(resource)}</td>
                  <td><span className={styles.state} data-ready={resource.preparation === 'ready' && resource.state === 'active'}>{resourceStatus(resource)}</span></td>
                  <td className={styles.usage}>
                    <span>{resource.usage?.total ? `${resource.usage.total} ${resource.usage.total === 1 ? 'reproducción' : 'reproducciones'}` : 'Sin registros'}</span>
                    {resource.usage?.lastStartedAt && (
                      <small>
                        Última:
                        {' '}
                        <time dateTime={new Date(resource.usage.lastStartedAt).toISOString()}>{new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(resource.usage.lastStartedAt)}</time>
                      </small>
                    )}
                  </td>
                  <td className={styles.rowActions}>
                    {resource.preparation === 'ready' && <Button className={`${styles.secondary} ${styles.iconAction}`} icon='PLAY' size={22} onClick={() => setPreview(resource)} aria-label={`Escuchar ${resource.title}`} title={`Escuchar ${resource.title}`} />}
                    <Button className={`${styles.secondary} ${styles.iconAction}`} icon='INFO_OUTLINE' size={22} onClick={() => setDetails(resource)} aria-label={`Detalles de ${resource.title}`} title={`Detalles de ${resource.title}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && (
        <div className={styles.pagination}>
          <span>{`${page.total} ${page.total === 1 ? 'audio' : 'audios'} · Página ${page.page} de ${Math.max(1, Math.ceil(page.total / page.pageSize))}`}</span>
          <Button disabled={page.page <= 1} onClick={() => change('page', String(page.page - 1))}>Anterior</Button>
          <Button disabled={page.page * page.pageSize >= page.total} onClick={() => change('page', String(page.page + 1))}>Siguiente</Button>
        </div>
      )}
      {preview && visible && (
        <section className={styles.preview} aria-label='Escucha local'>
          <div>
            <strong>{preview.title}</strong>
            <small>En este dispositivo</small>
          </div>
          <audio ref={audio} key={preview.id} controls autoPlay src={`${document.baseURI}api/animation/resources/${preview.id}/audio`} onError={() => setError('No se pudo abrir el audio. Revise su disponibilidad.')} />
          <Button className={styles.secondary} onClick={() => setPreview(null)}>Cerrar escucha</Button>
        </section>
      )}
      {form && visible && <AudioResourceForm key={`${kind}:${form}:${source?.id || ''}`} kind={kind} mode={form} providers={providers} source={source} onClose={() => setForm(null)} onSaved={saved} />}
      {details && visible && (
        <AudioResourceDetails
          resource={page?.items.find(resource => resource.id === details.id) ?? details}
          onClose={() => setDetails(null)}
          onChange={fresh}
          onDelete={() => {
            if (preview?.id === details.id) {
              audio.current?.pause()
              setPreview(null)
            }
            if (params.get('resourceId') === details.id) {
              const next = new URLSearchParams(params)
              next.delete('resourceId')
              setParams(next, { replace: true })
            }
            setNotice('Audio eliminado.')
            fresh()
          }}
          onVersion={() => {
            setSource(details)
            setDetails(null)
            setForm('generate')
          }}
        />
      )}
    </section>
  )
}
