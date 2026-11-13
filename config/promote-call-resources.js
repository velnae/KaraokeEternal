import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { connect, digest } from './promote-resources.js'
import { checksum, locked, readJSON, writeJSON } from './media-import.js'

const route = 'resource-promotion/calls'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function normalizeCallPromotion (input) {
  if (!input || Object.keys(input).some(key => !['source', 'target', 'names', 'listeningIntros'].includes(key))) throw new Error('Use source, target, names and listeningIntros only.')
  const value = structuredClone(input)
  for (const side of ['source', 'target']) {
    const endpoint = value[side]
    if (!endpoint || Object.keys(endpoint).some(key => !['baseUrl', 'roomId'].includes(key)) || !Number.isSafeInteger(endpoint.roomId) || endpoint.roomId < 1) throw new Error('Provide explicit source and target rooms.')
    const url = new URL(endpoint.baseUrl)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS, or isolated loopback HTTP.')
    endpoint.baseUrl = url.href.replace(/\/?$/, '/')
  }
  if (digest(value.source) === digest(value.target)) throw new Error('Source and target must differ.')
  for (const field of ['names', 'listeningIntros']) {
    value[field] ??= []
    if (value[field] !== 'all' && (!Array.isArray(value[field]) || value[field].some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) || new Set(value[field]).size !== value[field].length)) throw new Error(`Use ${field}: "all" or resource IDs.`)
  }
  if (!value.names.length && !value.listeningIntros.length) throw new Error('Select at least one name or listening introduction.')
  return value
}

const match = (items, source) => items.find(item => item.sourceId === source.sourceId) ?? items.find(item => item.text.normalize('NFC').toLocaleLowerCase('es') === source.text.normalize('NFC').toLocaleLowerCase('es'))
const same = (target, source) => target?.part && source.part && target.text === source.text && target.part.checksum === source.part.checksum
  && target.part.masterChecksum === source.part.masterChecksum && target.part.profileKey === source.part.profileKey
  && (source.type === 'listening' ? target.enabled === source.enabled : !target.archived && source.aliases.every(alias => target.aliases.includes(alias)))
const snapshot = api => api.call(`${route}/`)
const download = (api, id, format) => api.call(`${route}/parts/${id}/${format}`, { binary: true })

export async function planCallPromotion (input, directory, credentials = {}) {
  const scope = normalizeCallPromotion(input)
  return locked(directory, async () => {
    const planPath = path.join(directory, 'plan.json')
    try {
      await fs.access(planPath)
      throw new Error('Plan already exists; reuse it or choose a new bundle directory.')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const source = await connect(scope.source, credentials.source ?? process.env.KARAOKE_PROMOTE_SOURCE_STATE)
    let target
    try {
      target = await connect(scope.target, credentials.target ?? process.env.KARAOKE_PROMOTE_TARGET_STATE)
      const from = await snapshot(source), to = await snapshot(target)
      const plan = { version: 1, kind: 'call-resources', scope, items: [], createdAt: new Date().toISOString() }
      for (const [field, collection] of [['names', 'names'], ['listeningIntros', 'listening']]) {
        const selection = scope[field] === 'all' ? from[collection].filter(item => item.part && !item.archived).map(item => item.sourceId) : scope[field]
        for (const id of selection) {
          const resource = from[collection].find(item => item.sourceId === id)
          if (!resource?.part || !resource.profile || resource.archived) throw new Error(`Source resource is not ready: ${id}`)
          const existing = match(to[collection], resource)
          const item = { source: resource, expectedTag: existing?.tag ?? null, action: same(existing, resource) ? 'reuse' : existing ? 'replace-binding' : 'create' }
          const identity = digest(resource)
          item.files = { master: `${identity}.wav`, audio: `${identity}.mp3` }
          for (const format of ['master', 'audio']) {
            const bytes = await download(source, resource.part.id, format)
            const expected = format === 'master' ? resource.part.masterChecksum : resource.part.checksum
            if (hash(bytes) !== expected) throw new Error(`Source ${format} changed: ${id}`)
            await fs.writeFile(path.join(directory, item.files[format]), bytes, { mode: 0o600 })
          }
          plan.items.push(item)
        }
      }
      plan.fingerprint = digest(plan)
      await writeJSON(planPath, plan)
      return { planPath, fingerprint: plan.fingerprint, changes: plan.items.map(item => ({ type: item.source.type, text: item.source.text, action: item.action })) }
    } finally {
      await source.dispose()
      await target?.dispose()
    }
  })
}

export async function applyCallPromotion (planPath, confirmation, credentials = {}) {
  const directory = path.dirname(planPath)
  return locked(directory, async () => {
    const plan = await readJSON(planPath)
    const { fingerprint, ...unsigned } = plan
    if (plan.version !== 1 || plan.kind !== 'call-resources' || fingerprint !== digest(unsigned) || confirmation !== fingerprint) throw new Error('Confirm the unchanged call-resource plan fingerprint.')
    normalizeCallPromotion(plan.scope)
    for (const item of plan.items) for (const [format, filename] of Object.entries(item.files)) {
      const expected = format === 'master' ? item.source.part.masterChecksum : item.source.part.checksum
      if (path.basename(filename) !== filename || await checksum(path.join(directory, filename)) !== expected) throw new Error('Bundle files changed; do not publish.')
    }
    const receiptPath = path.join(directory, 'receipt.json')
    let receipt
    try {
      receipt = await readJSON(receiptPath)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    receipt ??= { fingerprint, status: 'pending', resources: {} }
    if (receipt.fingerprint !== fingerprint) throw new Error('Receipt belongs to another plan.')
    const save = () => writeJSON(receiptPath, receipt)
    const api = await connect(plan.scope.target, credentials.target ?? process.env.KARAOKE_PROMOTE_TARGET_STATE)
    try {
      // Check all planned bindings before the first write, including operator
      // edits made after a previous partially successful batch.
      const before = await snapshot(api)
      for (const item of plan.items) {
        const current = match(before[item.source.type === 'name' ? 'names' : 'listening'], item.source)
        if ((current?.tag ?? null) !== item.expectedTag && !same(current, item.source)) throw new Error(`Destination changed: ${item.source.text}. Compare again.`)
        const saved = receipt.resources[item.source.sourceId]
        if (saved && current?.tag !== saved.tag) throw new Error(`Completed binding changed: ${item.source.text}.`)
      }
      for (const item of plan.items) {
        const current = match((await snapshot(api))[item.source.type === 'name' ? 'names' : 'listening'], item.source)
        let resource = current
        if (!same(current, item.source)) {
          receipt.status = 'uploading'
          receipt.pending = item.source.sourceId
          await save()
          resource = await api.call(`${route}/import`, { method: 'POST', multipart: {
            metadata: JSON.stringify({ roomId: plan.scope.target.roomId, source: item.source, expectedTag: item.expectedTag }),
            master: { name: 'master.wav', mimeType: 'audio/wav', buffer: await fs.readFile(path.join(directory, item.files.master)) },
            audio: { name: 'audio.mp3', mimeType: 'audio/mpeg', buffer: await fs.readFile(path.join(directory, item.files.audio)) },
          } })
        }
        if (!same(resource, item.source)) throw new Error(`Imported resource mismatch: ${item.source.text}`)
        for (const format of ['master', 'audio']) {
          const bytes = await download(api, resource.part.id, format)
          if (hash(bytes) !== (format === 'master' ? item.source.part.masterChecksum : item.source.part.checksum)) throw new Error(`Destination ${format} checksum mismatch: ${item.source.text}`)
        }
        receipt.resources[item.source.sourceId] = { type: resource.type, text: resource.text, targetId: resource.sourceId, partId: resource.part.id,
          tag: resource.tag, checksum: resource.part.checksum, masterChecksum: resource.part.masterChecksum, status: 'verified' }
        delete receipt.pending
        await save()
      }
      receipt.status = 'verified'
      receipt.verifiedAt = new Date().toISOString()
      await save()
      return { receiptPath, ...receipt }
    } catch (error) {
      receipt.status = 'incomplete'
      await save()
      throw error
    } finally { await api.dispose() }
  })
}

async function main () {
  const [command, file, ...args] = process.argv.slice(2)
  if (command === 'plan' && file && args.length === 1) return planCallPromotion(await readJSON(file), path.resolve(args[0]))
  if (command === 'apply' && file && args.length === 2 && args[0] === '--confirm') return applyCallPromotion(path.resolve(file), args[1])
  if (command === 'inspect' && file && !args.length) return readJSON(path.resolve(file))
  if (!command || command === 'help') return { usage: ['plan <manifest.json> <bundle-directory>', 'apply <plan.json> --confirm <fingerprint>', 'inspect <plan.json|receipt.json>'] }
  throw new Error('Invalid command. Run help.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(value => console.log(JSON.stringify(value, null, 2))).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
