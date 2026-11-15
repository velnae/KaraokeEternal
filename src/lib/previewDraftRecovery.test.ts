import { expect, it, vi } from 'vitest'
import { recoverPreviewDraft } from './previewDraftRecovery'

function fixture () {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  const remote = { load: vi.fn(async () => ({ revision: 1, draft: 'Saved' })), save: vi.fn(async (_draft: string, revision: number) => ({ revision: revision + 1 })) }
  const validate = (value: unknown) => String(value)
  const create = (key = 'user:1:room:1') => recoverPreviewDraft(key, remote, validate, storage)
  return { storage, remote, create }
}

it('restores an immediate refresh or logout before the debounce/save starts, scoped to the same account', async () => {
  const { create, remote } = fixture()
  create().stage('Last keystroke', 1)
  expect(await create('user:2:room:1').load()).toEqual({ revision: 1, draft: 'Saved' })
  expect(await create().load()).toEqual({ revision: 1, draft: 'Last keystroke', pending: true })
  expect(remote.save).not.toHaveBeenCalled()
  const reopened = create()
  await reopened.load()
  await reopened.save('Last keystroke', 1)
  remote.load.mockResolvedValue({ revision: 2, draft: 'Last keystroke' })
  expect(await create().load()).toEqual({ revision: 2, draft: 'Last keystroke' })
})

it('recovers newer edits when an earlier write committed but the browser closed before its acknowledgment', async () => {
  const { create, remote } = fixture()
  let release!: (value: { revision: number }) => void
  remote.save.mockImplementation(() => new Promise((resolve) => {
    release = resolve
  }))
  const original = create()
  const write = original.save('First edit', 1)
  original.stage('Latest edit', 1)
  remote.load.mockResolvedValue({ revision: 2, draft: 'First edit' })
  expect(await create().load()).toEqual({ revision: 2, draft: 'Latest edit', pending: true })
  release({ revision: 2 })
  await write
  expect(await create().load()).toMatchObject({ draft: 'Latest edit' })
})

it('preserves both copies and refuses to overwrite newer changes from another window', async () => {
  const { create, remote, storage } = fixture()
  create().stage('Local edit', 1)
  remote.load.mockResolvedValue({ revision: 2, draft: 'Different window' })
  await expect(create().load()).rejects.toThrow('No se sobrescribió ninguno')
  expect(storage.getItem('user:1:room:1')).toContain('Local edit')
  expect(remote.save).not.toHaveBeenCalled()
})

it('keeps the pending edit on failed requests and clears it only after acknowledgment', async () => {
  const { create, remote, storage } = fixture()
  remote.save.mockRejectedValueOnce(new Error('Offline'))
  const first = create()
  first.stage('Pending', 1)
  await expect(first.save('Pending', 1)).rejects.toThrow('Offline')
  const next = create()
  expect(await next.load()).toMatchObject({ draft: 'Pending', pending: true })
  await next.save('Pending', 1)
  expect(storage.getItem('user:1:room:1')).toBeNull()
})
