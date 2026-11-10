import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { request } from 'playwright'
import { checksum, locked, readJSON, writeJSON } from './media-import.js'

export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
  : item)
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const same = (a, b) => canonical(a) === canonical(b)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const metadataFields = ['text', 'celebrationMode', 'effectType', 'family', 'modes', 'category', 'language', 'voiceName', 'style', 'loop', 'validUntil']
const audioMetadata = value => Object.fromEntries(metadataFields.filter(key => value[key] !== undefined).map(key => [key, value[key]]))
const audioConfig = item => ({ kind: item.kind, title: item.title, state: item.state, metadata: audioMetadata(item.metadata) })
const resourceConfig = (type, item) => type === 'audio'
  ? audioConfig(item)
  : type === 'background'
    ? { title: item.title, active: item.active }
    : { kind: item.kind, title: item.title, script: item.script ?? null }
const settingsConfig = (value) => {
  const settings = { ...value }
  delete settings.revision
  return settings
}

export function normalizeRequest (input) {
  if (!input || Object.keys(input).some(key => !['source', 'target', 'audio', 'backgrounds', 'backgroundSettings', 'birthdays'].includes(key))) throw new Error('Unknown promotion fields.')
  const result = structuredClone(input)
  for (const side of ['source', 'target']) {
    const endpoint = result[side]
    if (!endpoint || Object.keys(endpoint).some(key => !['baseUrl', 'roomId'].includes(key)) || !Number.isSafeInteger(endpoint.roomId) || endpoint.roomId < 1) throw new Error(`Provide ${side}.baseUrl and roomId.`)
    const url = new URL(endpoint.baseUrl)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS, or loopback HTTP for isolated tests.')
    endpoint.baseUrl = url.href.replace(/\/?$/, '/')
  }
  if (same(result.source, result.target)) throw new Error('Source and target must differ.')
  for (const key of ['audio', 'backgrounds']) {
    result[key] ??= []
    if (result[key] !== 'all' && (!Array.isArray(result[key]) || result[key].some(id => typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id)) || new Set(result[key]).size !== result[key].length)) throw new Error(`Use ${key}: "all" or an array of resource IDs.`)
  }
  for (const key of ['backgroundSettings', 'birthdays']) {
    result[key] ??= false
    if (typeof result[key] !== 'boolean') throw new Error(`${key} must be boolean.`)
  }
  if (!result.birthdays && !result.backgroundSettings && !result.audio.length && !result.backgrounds.length) throw new Error('Select resources or settings to promote.')
  return result
}

export async function connect (endpoint, storageState) {
  if (!storageState) throw new Error('Provide a private storage-state file for each environment.')
  const state = typeof storageState === 'string' ? await readJSON(storageState) : storageState
  const cookies = (state.cookies ?? []).filter(cookie => cookie.name === 'keToken' && cookie.domain.replace(/^\./, '') === new URL(endpoint.baseUrl).hostname)
  const context = await request.newContext({ storageState: { cookies, origins: [] }, timeout: 120_000, maxRedirects: 0 })
  const call = async (suffix, options = {}) => {
    const response = await context.fetch(new URL(`api/${suffix}`, endpoint.baseUrl).href, options)
    try {
      if (!response.ok()) throw Object.assign(new Error(`API ${suffix}: HTTP ${response.status()}: ${(await response.text()).slice(0, 500)}`), { status: response.status() })
      return options.binary ? await response.body() : await response.json()
    } finally { await response.dispose() }
  }
  try {
    const user = await call('user')
    if (!user.isAdmin || user.roomId !== endpoint.roomId) throw new Error('Administrator session does not match the expected room.')
    return { call, dispose: () => context.dispose() }
  } catch (error) {
    await context.dispose()
    throw error
  }
}

async function inventory (api, scope) {
  const result = { audio: [], backgrounds: [], birthdays: [] }
  if (scope.audio.length) {
    for (const kind of ['voice', 'effect', 'ambience']) {
      for (let page = 1; ; page++) {
        const batch = await api.call(`animation/resources?kind=${kind}&state=all&page=${page}`)
        result.audio.push(...batch.items)
        if (page * batch.pageSize >= batch.total) break
      }
    }
  }
  if (scope.backgrounds.length || scope.backgroundSettings) {
    const overview = await api.call('animation/background/')
    result.backgrounds = overview.videos
    result.backgroundSettings = overview.settings
  }
  if (scope.birthdays) {
    const overview = await api.call('birthdays/')
    result.birthdays = overview.assets
    result.birthdaySettings = overview.settings
  }
  return result
}

function select (items, selection, ready) {
  const selected = selection === 'all'
    ? items.filter(ready)
    : selection.map((id) => {
        const item = items.find(item => item.id === id)
        if (!item || !ready(item)) throw new Error(`Resource ${id} is missing or not ready.`)
        return item
      })
  return [...new Map(selected.map(item => [item.id, item])).values()]
}

export const birthdayDependencies = settings => [...new Set([settings.introId, settings.musicId, settings.videoId,
  ...(settings.introIds ?? []), ...settings.rules.map(rule => rule.videoId)].filter(Boolean))]

const mediaRoute = (type, id) => type === 'audio'
  ? `animation/resources/${id}/audio`
  : type === 'background' ? `animation/background/videos/${id}/video` : `birthdays/assets/${id}`
const itemRoute = (type, id) => type === 'audio' ? `animation/resources/${id}` : `animation/background/videos/${id}`

export async function planPromotion (input, directory, credentials = {}) {
  const scope = normalizeRequest(input)
  return locked(directory, async () => {
    const planPath = path.join(directory, 'plan.json')
    try {
      await fs.access(planPath)
      throw new Error('Plan already exists; reuse it or choose a new directory.')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const source = await connect(scope.source, credentials.source ?? process.env.KARAOKE_PROMOTE_SOURCE_STATE)
    let target
    try {
      target = await connect(scope.target, credentials.target ?? process.env.KARAOKE_PROMOTE_TARGET_STATE)
      const from = await inventory(source, scope)
      const to = await inventory(target, scope)
      const audio = select(from.audio, scope.audio, item => item.preparation === 'ready' && item.roomId !== null)
      const backgroundIds = scope.backgrounds === 'all' ? 'all' : [...scope.backgrounds]
      if (scope.backgroundSettings && backgroundIds !== 'all') {
        if (from.backgroundSettings.videoId) backgroundIds.push(from.backgroundSettings.videoId)
        if (from.backgroundSettings.mode === 'all') backgroundIds.push(...from.backgrounds.filter(item => item.active).map(item => item.id))
      }
      const backgrounds = select(from.backgrounds, backgroundIds, item => item.state === 'ready')
      const birthdays = scope.birthdays ? select(from.birthdays, birthdayDependencies(from.birthdaySettings), item => !!item.checksum) : []
      const plan = { version: 1, scope, items: [], settings: {}, before: {}, createdAt: new Date().toISOString() }
      for (const [type, items, candidates] of [['audio', audio, to.audio], ['background', backgrounds, to.backgrounds], ['birthday', birthdays, to.birthdays]]) {
        for (const resource of items) {
          const config = resourceConfig(type, resource)
          // Uploading a background alone must not make it eligible for rotation.
          if (type === 'background' && !scope.backgroundSettings) config.active = false
          const key = digest({ type, checksum: resource.checksum, config })
          const matching = candidates.find(item => item.checksum === resource.checksum && same(resourceConfig(type, item), config)
            && (type !== 'audio' || item.roomId === scope.target.roomId) && (type !== 'background' || item.state === 'ready'))
          const item = { type, sourceId: resource.id, checksum: resource.checksum, config, key, requestId: `promote-${key.slice(0, 48)}`, targetId: matching?.id ?? null }
          if (!matching) {
            const bytes = await source.call(mediaRoute(type, resource.id), { binary: true })
            if (createHash('sha256').update(bytes).digest('hex') !== item.checksum) throw new Error(`Source checksum changed: ${resource.id}`)
            item.file = `${key}.${type === 'background' || resource.kind === 'video' ? 'mp4' : resource.mime === 'audio/ogg' ? 'ogg' : resource.mime === 'audio/wav' ? 'wav' : 'mp3'}`
            await fs.writeFile(path.join(directory, item.file), bytes, { mode: 0o600 })
          }
          plan.items.push(item)
        }
      }
      if (scope.backgroundSettings) {
        plan.settings.background = from.backgroundSettings
        plan.before.background = to.backgroundSettings
      }
      if (scope.birthdays) {
        plan.settings.birthday = from.birthdaySettings
        plan.before.birthday = to.birthdaySettings
      }
      plan.fingerprint = digest(plan)
      await writeJSON(planPath, plan)
      return { planPath, fingerprint: plan.fingerprint, upload: plan.items.filter(item => !item.targetId).length, reuse: plan.items.filter(item => item.targetId).length,
        changes: plan.items.map(item => ({ type: item.type, title: item.config.title, sourceId: item.sourceId, action: item.targetId ? 'reuse' : 'upload-or-reconcile' })), settings: Object.keys(plan.settings) }
    } finally {
      await source.dispose()
      await target?.dispose()
    }
  })
}

export function mappedSettings (type, value, items, receipt) {
  const map = (kind, id) => {
    if (!id) return id
    const item = items.find(item => item.type === kind && item.sourceId === id)
    const target = item && (receipt.resources[item.key]?.id ?? item.targetId)
    if (!target) throw new Error(`Missing promoted dependency: ${id}`)
    return target
  }
  const settings = structuredClone(value)
  if (type === 'background') settings.videoId = map('background', settings.videoId)
  else {
    for (const key of ['introId', 'musicId', 'videoId']) settings[key] = map('birthday', settings[key])
    if (settings.introIds) settings.introIds = settings.introIds.map(id => map('birthday', id))
    settings.rules = settings.rules.map(rule => ({ ...rule, ...(rule.videoId ? { videoId: map('birthday', rule.videoId) } : {}) }))
  }
  return settings
}

async function currentSettings (api, type) {
  return (await api.call(type === 'background' ? 'animation/background/' : 'birthdays/')).settings
}

async function verifyMedia (api, type, resource) {
  const bytes = await api.call(mediaRoute(type, resource.id), { binary: true })
  if (createHash('sha256').update(bytes).digest('hex') !== resource.checksum) throw new Error(`Target checksum mismatch: ${resource.id}`)
}

async function uploadItem (api, item, directory) {
  const bytes = await fs.readFile(path.join(directory, item.file))
  const file = { name: item.file, mimeType: item.file.endsWith('.mp4') ? 'video/mp4' : item.file.endsWith('.ogg') ? 'audio/ogg' : item.file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', buffer: bytes }
  if (item.type === 'birthday') return api.call('birthdays/import', { method: 'POST', multipart: { metadata: JSON.stringify({ ...item.config, script: item.config.script ?? undefined, checksum: item.checksum }), file } })
  const audio = item.type === 'audio'
  return api.call(audio ? 'animation/resources/upload' : 'animation/background/upload', { method: 'POST', headers: { 'X-Upload-Request-Id': item.requestId }, multipart: {
    requestId: item.requestId, title: item.config.title, ...(audio ? { kind: item.config.kind, metadata: JSON.stringify(item.config.metadata) } : {}), file,
  } })
}

export async function applyPromotion (planPath, confirmation, credentials = {}) {
  const directory = path.dirname(planPath)
  return locked(directory, async () => {
    const plan = await readJSON(planPath)
    const { fingerprint, ...unsigned } = plan
    if (plan.version !== 1 || fingerprint !== digest(unsigned) || confirmation !== fingerprint) throw new Error('Confirm the unchanged plan fingerprint before applying.')
    normalizeRequest(plan.scope)
    // Validate every local file before the first remote write.
    for (const item of plan.items) {
      if (item.file && (path.basename(item.file) !== item.file || await checksum(path.join(directory, item.file)) !== item.checksum)) throw new Error(`Bundle file changed: ${item.sourceId}`)
    }
    const receiptPath = path.join(directory, 'receipt.json')
    let receipt
    try {
      receipt = await readJSON(receiptPath)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    receipt ??= { fingerprint, resources: {}, settings: {}, status: 'pending' }
    if (receipt.fingerprint !== fingerprint) throw new Error('Receipt belongs to a different plan.')
    const save = () => writeJSON(receiptPath, receipt)
    const api = await connect(plan.scope.target, credentials.target ?? process.env.KARAOKE_PROMOTE_TARGET_STATE)
    try {
      // Detect concurrent configuration edits before uploading anything.
      for (const [type, before] of Object.entries(plan.before)) {
        const current = await currentSettings(api, type)
        let desired
        try {
          desired = mappedSettings(type, plan.settings[type], plan.items, receipt)
        } catch { /* Dependencies have not been imported yet. */ }
        if (!same(current, before) && !(desired && same(settingsConfig(current), settingsConfig(desired)))) throw new Error(`Target ${type} settings changed; prepare a new plan.`)
      }
      for (const item of plan.items) {
        let resource
        const recorded = receipt.resources[item.key]
        const targetId = recorded?.id ?? item.targetId ?? (item.type === 'audio' ? `uploaded-${item.requestId}` : null)
        if (targetId) {
          try {
            resource = item.type === 'birthday' ? (await api.call('birthdays/')).assets.find(asset => asset.id === targetId) : await api.call(itemRoute(item.type, targetId))
          } catch (error) { if (error.status !== 404 || recorded || item.targetId) throw error }
          if (!resource && (recorded || item.targetId)) throw new Error(`Promoted resource disappeared: ${targetId}`)
        }
        if (!resource) {
          receipt.status = 'uploading'
          receipt.pending = item.key
          await save()
          resource = await uploadItem(api, item, directory)
          receipt.resources[item.key] = { id: resource.id, status: 'preparing' }
          await save()
        }
        const deadline = Date.now() + 120_000
        while ((resource.preparation ?? resource.state) === 'preparing' && Date.now() < deadline) {
          await sleep(500)
          resource = await api.call(itemRoute(item.type, resource.id))
        }
        if (item.type !== 'birthday' && (item.type === 'audio' ? resource.preparation : resource.state) !== 'ready') throw new Error(`Resource ${resource.id} is not ready; resume this receipt after checking its state.`)
        if (recorded?.checksum && recorded.checksum !== resource.checksum) throw new Error(`Target resource changed: ${resource.id}`)
        if (item.targetId && !same(resourceConfig(item.type, resource), item.config)) throw new Error(`Reused resource metadata changed: ${resource.id}`)
        if (item.type === 'audio') {
          if (!same(audioConfig(resource), item.config)) {
            // Never overwrite edits to a resource already verified by this run.
            if (recorded?.status === 'verified') throw new Error(`Target metadata changed: ${resource.id}`)
            resource = await api.call(itemRoute('audio', resource.id), { method: 'PATCH', data: { title: item.config.title, state: item.config.state, metadata: item.config.metadata } })
          }
        } else if (item.type === 'background' && resource.active !== item.config.active) {
          if (recorded?.status === 'verified') throw new Error(`Target activation changed: ${resource.id}`)
          await api.call(itemRoute('background', resource.id), { method: 'PATCH', data: { active: item.config.active } })
          resource = await api.call(itemRoute('background', resource.id))
        }
        if (item.targetId && resource.checksum !== item.checksum) throw new Error(`Reused resource changed: ${resource.id}`)
        await verifyMedia(api, item.type, resource)
        receipt.resources[item.key] = { id: resource.id, checksum: resource.checksum, status: 'verified' }
        delete receipt.pending
        await save()
      }
      for (const [type, value] of Object.entries(plan.settings)) {
        const desired = mappedSettings(type, value, plan.items, receipt)
        const current = await currentSettings(api, type)
        if (!same(settingsConfig(current), settingsConfig(desired))) {
          if (!same(current, plan.before[type])) throw new Error(`Target ${type} settings changed; prepare a new plan.`)
          receipt.settings[type] = { status: 'saving', before: current }
          await save()
          await api.call(type === 'background' ? 'animation/background/' : 'birthdays/settings', { method: 'PUT', data: { ...desired, revision: current.revision } })
        }
        const verified = await currentSettings(api, type)
        if (!same(settingsConfig(verified), settingsConfig(desired))) throw new Error(`Settings verification failed: ${type}`)
        receipt.settings[type] = { status: 'verified', before: plan.before[type], after: verified }
        await save()
      }
      receipt.status = 'verified'
      await save()
      return { receiptPath, status: receipt.status, resources: Object.values(receipt.resources), settings: Object.keys(receipt.settings) }
    } catch (error) {
      receipt.status = 'incomplete'
      await save()
      throw error
    } finally { await api.dispose() }
  })
}

async function main () {
  const [command, file, ...args] = process.argv.slice(2)
  if (command === 'plan' && file && args.length === 1) return planPromotion(await readJSON(file), path.resolve(args[0]))
  if (command === 'apply' && file && args.length === 2 && args[0] === '--confirm') return applyPromotion(path.resolve(file), args[1])
  if (command === 'inspect' && file && !args.length) return readJSON(path.resolve(file))
  if (!command || command === 'help') return { usage: ['plan <manifest.json> <bundle-directory>', 'inspect <plan.json|receipt.json>', 'apply <plan.json> --confirm <fingerprint>'], authentication: 'KARAOKE_PROMOTE_SOURCE_STATE / KARAOKE_PROMOTE_TARGET_STATE: private storage-state paths; no browser is launched.' }
  throw new Error('Invalid command. Run help.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
