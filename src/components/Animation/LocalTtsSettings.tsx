import React, { useEffect, useId, useRef, useState } from 'react'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { defaultLocalTtsConfig, localTtsLabels, type LocalTtsConfig, type LocalTtsSnapshot } from 'shared/localTts'
import styles from './LocalTtsSettings.css'
import useGreetings from 'components/Greetings/useGreetings'
import GreetingPlaybackControls from 'components/Greetings/GreetingPlaybackControls'

const api = new HttpApi('prefs/local-tts')

export default function LocalTtsSettings () {
  const id = useId()
  const [snapshot, setSnapshot] = useState<LocalTtsSnapshot | null>(null)
  const [draft, setDraft] = useState<LocalTtsConfig>({ ...defaultLocalTtsConfig })
  const [dirty, setDirty] = useState(false)
  const edited = useRef(false)
  const sequence = useRef(0)
  const mounted = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const greetings = useGreetings()

  useEffect(() => {
    mounted.current = true
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const version = ++sequence.current
      try {
        const result = await api.get<LocalTtsSnapshot>('')
        if (!alive || version !== sequence.current) return
        setSnapshot(result)
        if (!edited.current) setDraft(result.config)
      } catch (error) {
        if (alive && version === sequence.current) setError((error as Error).message)
      } finally {
        if (alive) timer = setTimeout(() => void load(), 1500)
      }
    }
    void load()
    return () => {
      alive = false
      mounted.current = false
      clearTimeout(timer)
    }
  }, [])

  const change = (patch: Partial<LocalTtsConfig>) => {
    edited.current = true
    setDirty(true)
    setNotice('')
    setDraft(value => ({ ...value, ...patch }))
  }
  const execute = async (action: 'save' | 'check' | 'start' | 'reload') => {
    if (busy) return
    sequence.current++
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let result: LocalTtsSnapshot
      if (action === 'save') result = await api.put<LocalTtsSnapshot>('', { body: draft })
      else if (action === 'reload') result = await api.get<LocalTtsSnapshot>('')
      else result = await api.post<LocalTtsSnapshot>(`/${action}`)
      if (!mounted.current) return
      sequence.current++
      setSnapshot(result)
      if (action === 'save' || action === 'reload') {
        edited.current = false
        setDirty(false)
        setDraft(result.config)
      }
      if (action === 'save') setNotice('Configuración guardada.')
    } catch (error) {
      if (mounted.current) setError((error as Error).message)
    } finally { if (mounted.current) setBusy(false) }
  }
  const processing = !!snapshot && ['checking', 'starting', 'busy', 'generating', 'recovering'].includes(snapshot.state)
  const changedElsewhere = !!snapshot && dirty && draft.revision !== snapshot.config.revision
  let help = 'Comprobar conexión consulta el estado del modelo sin generar audio.'
  if (!snapshot) help = 'Espere a que carguen los ajustes. Si la conexión falla, pulse Recargar ajustes.'
  else if (busy) help = 'Enviando la solicitud al servidor…'
  else if (changedElsewhere) help = 'Los ajustes cambiaron en otra sesión. Recargue antes de guardar.'
  else if (dirty) help = 'Guarde los cambios antes de comprobar o iniciar el modelo.'
  else if (snapshot.pending) help = 'El cambio espera la respuesta del modelo actual. Si la comprobación termina con error, vuelva a comprobar la conexión.'
  else if (processing) help = 'La operación continúa en segundo plano. Puede salir de esta pestaña.'
  else if (!snapshot.config.installationPath) help = 'Indique la carpeta de instalación y pulse Guardar y comprobar.'

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.heading}>
        <h2 id={`${id}-title`}>Voz local para saludos</h2>
        <p>Conecte Chatterbox LATAM instalado en el servidor del karaoke.</p>
      </header>
      <div className={styles.status} data-state={snapshot?.state} role='status'>
        <strong>{snapshot ? localTtsLabels[snapshot.state] : error ? 'No se pudieron cargar los ajustes' : 'Cargando ajustes…'}</strong>
        <p>{snapshot?.message || 'La conexión es compartida por las salas de este servidor.'}</p>
        {snapshot?.checkedAt && <small>{`Última comprobación: ${new Date(snapshot.checkedAt).toLocaleTimeString()}`}</small>}
        {snapshot?.pending && <p className={styles.pending}>{`Cambio pendiente. Instalación actual: ${snapshot.activePath}`}</p>}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          void execute('save')
        }}
      >
        <label className={styles.field} htmlFor={`${id}-path`}>
          Ruta de instalación en el servidor
          <input
            id={`${id}-path`}
            type='text'
            value={draft.installationPath}
            onChange={event => change({ installationPath: event.target.value })}
            placeholder='/ruta/a/chatterbox-latam-test'
            autoComplete='off'
            spellCheck={false}
            disabled={!snapshot || busy}
            aria-describedby={`${id}-path-help`}
          />
        </label>
        <p id={`${id}-path-help`} className={styles.hint}>La carpeta que contiene model.sh y resident.py. Esta ruta pertenece al servidor, no a este navegador.</p>
        <label className={styles.check}>
          <input type='checkbox' checked={draft.autoStart} disabled={!snapshot || busy} onChange={event => change({ autoStart: event.target.checked })} />
          Iniciar el modelo automáticamente al abrir el servidor
        </label>
        <p className={styles.hint}>Al activar esta opción, se prepara ahora y en los próximos inicios del servidor.</p>
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={!snapshot || busy || changedElsewhere} aria-describedby={`${id}-help`}>{busy ? 'Procesando…' : 'Guardar y comprobar'}</Button>
          <Button disabled={!(snapshot?.config.installationPath || snapshot?.activePath) || busy || dirty || processing} aria-describedby={`${id}-help`} onClick={() => void execute('check')}>Comprobar conexión</Button>
          {snapshot?.state !== 'ready' && <Button disabled={!snapshot?.config.installationPath || busy || dirty || processing || snapshot.pending} aria-describedby={`${id}-help`} onClick={() => void execute('start')}>Iniciar modelo</Button>}
        </div>
        <p id={`${id}-help`} className={styles.hint} role='status'>{help}</p>
        {notice && <p className={styles.notice} role='status'>{snapshot?.pending ? 'Ruta guardada. Se aplicará cuando el modelo actual responda.' : notice}</p>}
        {error && <p className={styles.error} role='alert'>{error}</p>}
        {(error || changedElsewhere) && <Button onClick={() => void execute('reload')} disabled={busy}>Recargar ajustes</Button>}
      </form>
      <div className={styles.preparation}>
        <h3>Preparación de saludos en esta sala</h3>
        <label className={styles.check}>
          <input
            type='checkbox'
            checked={greetings.snapshot?.audioEnabled ?? false}
            disabled={!greetings.snapshot || greetings.busy}
            aria-describedby={`${id}-preparation-help`}
            onChange={event => void greetings.execute('prepareAudio', { enabled: event.target.checked })}
          />
          Preparar voz mientras los pedidos esperan
        </label>
        <p id={`${id}-preparation-help`} className={styles.hint}>{!greetings.snapshot ? 'Conectando con la sala para cargar esta opción.' : greetings.busy ? 'Esperando la confirmación del servidor…' : 'Se genera únicamente el saludo, de uno en uno. Si la voz falla o tarda, su entrega en pantalla continúa.'}</p>
        {greetings.error && <p className={styles.error} role='alert'>{greetings.error}</p>}
      </div>
      <GreetingPlaybackControls snapshot={greetings.snapshot} busy={greetings.busy} save={(settings, version) => void greetings.execute('playback', { settings, version })} />
      <p className={styles.scope}>Chatterbox genera únicamente el saludo. La presentación y el fondo provienen del catálogo. Desactivar la preparación también desactiva la lectura en voz alta.</p>
    </section>
  )
}
