import React, { useEffect, useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import Panel from 'components/Panel/Panel'
import HttpApi from 'lib/HttpApi'
import { AVATAR_UPLOAD_MAX, avatarGroups, type AvatarCategory, type AvatarEntry } from 'shared/avatars'
import styles from './AvatarSettings.css'

const api = new HttpApi()
const avatarName = (avatar: AvatarEntry) => avatar.category === 'general'
  ? 'Avatar genérico'
  : `${avatarGroups.find(group => group.id === avatar.category)?.label} ${Number(avatar.id.split('/')[1])}`

export default function AvatarSettings () {
  const [catalog, setCatalog] = useState<AvatarEntry[]>()
  const [category, setCategory] = useState<AvatarCategory>('varon')
  const [editing, setEditing] = useState<AvatarEntry | 'new'>()
  const [file, setFile] = useState<File>()
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => {
    setError('')
    void api.get<AvatarEntry[]>('avatars?all=1').then(setCatalog).catch((err: Error) => setError(err.message))
  }
  useEffect(load, [])
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const close = () => {
    if (busy) return
    setEditing(undefined)
    setFile(undefined)
    setPreview('')
    setError('')
  }
  const edit = (item: AvatarEntry | 'new') => {
    setNotice('')
    setError('')
    setEditing(item)
  }
  const update = async (action: () => Promise<AvatarEntry[]>, message: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setCatalog(await action())
      setEditing(undefined)
      setFile(undefined)
      setPreview('')
      setNotice(message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    if (!file) return setError('Seleccione una imagen.')
    if (file.size > AVATAR_UPLOAD_MAX) return setError('Seleccione una imagen de hasta 2 MB.')
    void update(async () => {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
        reader.readAsDataURL(file)
      })
      return api.post<AvatarEntry[]>('avatars/image', { body: editing === 'new' ? { category, image } : { id: editing?.id, image } })
    }, editing === 'new' ? 'Avatar agregado.' : 'Imagen reemplazada.')
  }

  const generic = catalog?.find(avatar => avatar.category === 'general')
  const content = (
    <>
      {!catalog && !error && <p role='status'>Cargando avatares…</p>}
      {!editing && error && <p role='alert'>{error}</p>}
      {!catalog && error && <Button onClick={load}>Volver a intentar</Button>}
      {notice && <p role='status'>{notice}</p>}
      {generic && (
        <div className={styles.generic}>
          <img src={new URL(generic.url, document.baseURI).href} alt='' width={72} height={72} />
          <strong>Avatar genérico</strong>
          <Button disabled={busy} onClick={() => edit(generic)}>Reemplazar genérico</Button>
        </div>
      )}
      {catalog && (
        <>
          <div className={styles.toolbar}>
            <div role='group' aria-label='Categoría de avatares'>
              {avatarGroups.map(group => <Button key={group.id} aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>{group.label}</Button>)}
            </div>
            <Button variant='primary' disabled={busy} onClick={() => edit('new')}>Agregar avatar</Button>
          </div>
          <ul className={styles.grid}>
            {catalog.filter(avatar => avatar.category === category).map(avatar => (
              <li key={avatar.id}>
                <img src={new URL(avatar.url, document.baseURI).href} alt='' width={80} height={80} />
                <strong>{avatarName(avatar)}</strong>
                {!avatar.active && <span>Oculto</span>}
                <Button disabled={busy} aria-label={`Reemplazar ${avatarName(avatar)}`} onClick={() => edit(avatar)}>Reemplazar</Button>
                <Button
                  disabled={busy}
                  aria-label={`${avatar.active ? 'Ocultar' : 'Mostrar'} ${avatarName(avatar)}`}
                  onClick={() => void update(() => api.request<AvatarEntry[]>('PATCH', 'avatars/visibility', { body: { id: avatar.id, active: !avatar.active } }), avatar.active ? 'Avatar ocultado.' : 'Avatar visible.')}
                >
                  {avatar.active ? 'Ocultar' : 'Mostrar'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'Agregar avatar' : `Reemplazar ${avatarName(editing)}`} onClose={close} buttons={<Button variant='primary' disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar avatar'}</Button>}>
          <div className={styles.editor}>
            {editing === 'new' && <strong>{avatarGroups.find(group => group.id === category)?.label}</strong>}
            {preview && <img src={preview} alt='Vista previa del avatar' width={120} height={120} />}
            <label>
              Imagen del avatar
              <input
                type='file'
                accept='image/png,image/jpeg,image/webp'
                disabled={busy}
                onChange={(e) => {
                  setError('')
                  setPreview('')
                  setFile(e.target.files?.[0])
                }}
              />
            </label>
            {error && <p role='alert'>{error}</p>}
          </div>
        </Modal>
      )}
    </>
  )
  return <Panel title='Catálogo de invitados'>{content}</Panel>
}
