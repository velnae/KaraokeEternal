interface PendingDraft<T> {
  revision: number
  draft: T
  inFlight?: { revision: number, draft: T }
}
interface Remote<T, S> {
  load(): Promise<S>
  save(draft: T, revision: number): Promise<{ revision: number }>
}

// SQLite remains authoritative. This account-scoped outbox contains only edits
// awaiting acknowledgment, so refresh/logout cannot discard an unsent keystroke.
export function recoverPreviewDraft<T, S extends { revision: number, draft: T | null }> (
  key: string, remote: Remote<T, S>, validate: (value: unknown) => T,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  let pending: PendingDraft<T> | undefined
  const write = () => {
    if (pending) storage?.setItem(key, JSON.stringify(pending))
    else storage?.removeItem(key)
  }
  return {
    async load (): Promise<S & { pending?: boolean }> {
      const saved = await remote.load()
      const raw = storage?.getItem(key)
      if (!raw) return saved
      const record: PendingDraft<T> = JSON.parse(raw)
      record.draft = validate(record.draft)
      if (!Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error('No se pudo recuperar el borrador pendiente.')
      if (same(saved.draft, record.draft)) {
        storage?.removeItem(key)
        return saved
      }
      const ownWrite = record.inFlight && saved.revision === record.inFlight.revision + 1 && same(saved.draft, record.inFlight.draft)
      if (saved.revision !== record.revision && !ownWrite) throw new Error('Hay cambios pendientes en este navegador y un borrador distinto en el servidor. No se sobrescribió ninguno.')
      pending = { revision: saved.revision, draft: record.draft }
      write()
      return { ...saved, draft: record.draft, pending: true }
    },
    stage (draft: T, revision: number) {
      pending = { ...pending, draft, revision }
      write()
    },
    async save (draft: T, revision: number) {
      pending = { draft, ...pending, revision, inFlight: { draft, revision } }
      write()
      const result = await remote.save(draft, revision)
      // A different tab may have staged its own changes. Never clear its outbox.
      const stored = storage?.getItem(key)
      if (!stored || same(JSON.parse(stored), pending)) {
        pending = same(pending.draft, draft) ? undefined : { draft: pending.draft, revision: result.revision }
        write()
      }
      return result
    },
  }
}
