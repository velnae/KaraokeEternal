import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import { useAppSelector } from 'store/hooks'
import { birthdayOutcomeLabels, birthdayOutcomes, type BirthdayHistoryPage } from 'shared/birthdayHistory'
import { birthdayApi } from './api'
import BirthdayHistoryDetail from './BirthdayHistoryDetail'
import { birthdayDate, birthdayDuration } from './historyFormatting'
import styles from './BirthdayHistory.css'

export default function BirthdayHistory () {
  const roomId = useAppSelector(state => state.user.roomId)
  const [params, setParams] = useSearchParams()
  const query = new URLSearchParams([...params].filter(([key]) => ['search', 'outcome', 'from', 'to', 'page'].includes(key))).toString()
  const [result, setResult] = useState<{ key: string, page?: BirthdayHistoryPage, error?: string }>({ key: '' })
  const [refresh, setRefresh] = useState(0)
  const requestKey = `${roomId}:${query}:${refresh}`
  const page = result.key === requestKey ? result.page : undefined
  const error = !roomId ? 'Seleccione una sala para consultar el historial.' : result.key === requestKey ? result.error : ''
  const loading = !!roomId && result.key !== requestKey
  const opener = useRef<HTMLButtonElement | null>(null)
  const region = useRef<HTMLElement>(null)
  const selected = params.get('event')
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    if (!roomId) return
    void birthdayApi.get<BirthdayHistoryPage>(`history?${query}`, { signal: controller.signal }).then((value): void => {
      if (live) setResult({ key: requestKey, page: value })
      return undefined
    }).catch((failure) => {
      if (live) setResult({ key: requestKey, error: failure.message })
    })
    return () => {
      live = false
      controller.abort()
    }
  }, [query, roomId, requestKey])
  const apply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      for (const key of ['search', 'outcome', 'from', 'to']) {
        const value = String(form.get(key) ?? '').trim()
        if (value) next.set(key, value)
        else next.delete(key)
      }
      next.delete('page')
      next.delete('rating')
      return next
    })
    setRefresh(value => value + 1)
  }
  const open = (id: string, button: HTMLButtonElement, listen = false) => {
    opener.current = button
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('event', id)
      if (listen) next.set('listen', '1')
      else next.delete('listen')
      return next
    })
  }
  const close = () => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete('event')
      next.delete('listen')
      return next
    }, { replace: true })
    requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
      else region.current?.focus({ preventScroll: true })
    })
  }
  const move = (number: number) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    next.set('page', String(number))
    return next
  })
  return (
    <section ref={region} tabIndex={-1} aria-label='Historial de cumpleaños' className={styles.history}>
      <form key={query} onSubmit={apply} className={styles.filters}>
        <label>
          Buscar por nombre
          <input name='search' type='search' maxLength={100} defaultValue={params.get('search') ?? ''} />
        </label>
        <label>
          Desde
          <input name='from' type='date' defaultValue={params.get('from') ?? ''} />
        </label>
        <label>
          Hasta
          <input name='to' type='date' defaultValue={params.get('to') ?? ''} />
        </label>
        <label>
          Resultado
          <select name='outcome' defaultValue={params.get('outcome') ?? ''}>
            <option value=''>Todos</option>
            {birthdayOutcomes.map(value => <option key={value} value={value}>{birthdayOutcomeLabels[value]}</option>)}
          </select>
        </label>
        <Button type='submit'>Buscar</Button>
        {query && <Button type='button' onClick={() => setParams({ view: 'history' })}>Limpiar filtros</Button>}
      </form>
      {loading && <p role='status'>Cargando historial…</p>}
      {error && (
        <div role='alert'>
          <p>{error}</p>
          <Button onClick={() => setRefresh(value => value + 1)}>Reintentar</Button>
        </div>
      )}
      {page && !page.items.length && (
        <div className={styles.empty}>
          <h2>No se encontraron cumpleaños</h2>
          <p>{query ? 'Pruebe otro nombre o ajuste los filtros.' : 'Los cumpleaños preparados aparecerán aquí.'}</p>
        </div>
      )}
      {page && page.items.length > 0 && (
        <>
          <table className={styles.table}>
            <caption className={styles.count}>{`${page.total} cumpleaños · Horario de Lima`}</caption>
            <thead>
              <tr>
                <th>Persona</th>
                <th>Fecha de creación</th>
                <th>Resultado</th>
                <th>Saludo</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(item => (
                <tr key={item.id}>
                  <td><button className={styles.name} onClick={event => open(item.id, event.currentTarget)} aria-label={`Ver cumpleaños de ${item.name}`}>{item.name}</button></td>
                  <td><time dateTime={new Date(item.createdAt).toISOString()}>{birthdayDate(item.createdAt)}</time></td>
                  <td>{birthdayOutcomeLabels[item.outcome]}</td>
                  <td>
                    <span>{birthdayDuration(item.greetingDurationMs)}</span>
                    {item.greetingId && item.greetingDurationMs !== null && <Button aria-label={`Escuchar saludo de ${item.name}`} onClick={event => open(item.id, event.currentTarget, true)}>Escuchar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.pagination}>
            <span>{`Página ${page.page} de ${Math.max(1, Math.ceil(page.total / page.pageSize))}`}</span>
            <Button disabled={page.page <= 1} onClick={() => move(page.page - 1)}>Anterior</Button>
            <Button disabled={page.page * page.pageSize >= page.total} onClick={() => move(page.page + 1)}>Siguiente</Button>
          </div>
        </>
      )}
      {selected && roomId && <BirthdayHistoryDetail key={`${roomId}:${selected}`} id={selected} listen={params.get('listen') === '1'} onClose={close} />}
    </section>
  )
}
