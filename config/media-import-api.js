import fs from 'node:fs/promises'
import path from 'node:path'
import { request } from 'playwright'
import { checksum, locked, normalizeManifest, readJSON, writeJSON } from './media-import.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function upload (receiptPath, { storageState = process.env.KARAOKE_IMPORT_STORAGE_STATE, timeout = 120_000 } = {}) {
  return locked(path.dirname(receiptPath), async () => {
    const receipt = await readJSON(receiptPath)
    const manifest = normalizeManifest(receipt.manifest)
    if (manifest.destination === 'file') throw new Error('This is a file-only request; no upload destination was requested.')
    if (!storageState) throw new Error('Set KARAOKE_IMPORT_STORAGE_STATE to a private Playwright storage-state file from the authenticated admin session.')
    if (!/^[a-f0-9]{32}$/.test(receipt.id) || await checksum(receipt.file) !== receipt.checksum) throw new Error('Receipt or prepared media changed; do not upload.')
    const api = await request.newContext({ storageState, timeout, maxRedirects: 0 })
    const call = async (suffix, options = {}) => {
      const response = await api.fetch(new URL(`api/${suffix}`, manifest.baseUrl).href, options)
      if (!response.ok()) throw Object.assign(new Error(`API ${suffix}: HTTP ${response.status()}. Check the session, room and resource state.`), { status: response.status() })
      if (response.status() === 204 || !(await response.body()).length) return null
      return response.headers()['content-type']?.includes('application/json') ? response.json() : response.text()
    }
    const save = async (patch) => {
      Object.assign(receipt, patch)
      await writeJSON(receiptPath, receipt)
    }
    try {
      const user = await call('user')
      if (!user.isAdmin || user.roomId !== manifest.roomId) throw new Error('Administrator session does not match the expected room. Sign in to the requested room first.')
      if (manifest.destination === 'library') {
        const prefs = await call('prefs')
        const configured = prefs.paths?.entities?.[manifest.pathId]?.path
        if (!configured || await fs.realpath(configured) !== await fs.realpath(manifest.libraryPath)) throw new Error('libraryPath does not match the configured pathId on this host.')
        // Publish a complete file atomically, without overwriting an existing entry.
        const folder = path.join(manifest.libraryPath, `youtube-${receipt.id}`)
        await fs.mkdir(folder, { recursive: true })
        if (await fs.realpath(folder) !== path.join(await fs.realpath(manifest.libraryPath), `youtube-${receipt.id}`)) throw new Error('Library import folder must not be a symbolic link.')
        const config = { delimiter: ' - ', articles: [], artist: { $eval: 'meta.artist' }, title: { $eval: 'meta.title' } }
        const configFile = path.join(folder, '_kes.v2.json')
        try {
          await fs.writeFile(configFile, JSON.stringify(config), { flag: 'wx' })
        } catch (error) {
          if (error.code !== 'EEXIST' || JSON.stringify(await readJSON(configFile)) !== JSON.stringify(config)) throw new Error('Library import folder has a different parser configuration.')
        }
        const filename = path.join(folder, 'Artist - Title.mp4')
        if (receipt.targetFile && receipt.targetFile !== filename) throw new Error('Library destination changed.')
        await save({ status: 'copying', targetFile: filename })
        const staged = path.join(folder, '.media.part')
        try {
          try {
            if (await checksum(filename) !== receipt.checksum) throw new Error('An unrelated file occupies the library destination.')
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
            await fs.copyFile(receipt.file, staged)
            await fs.link(staged, filename)
          }
        } finally { await fs.rm(staged, { force: true }) }
        await save({ status: 'copied' })
        await call(`prefs/path/${manifest.pathId}/scan`)
        await save({ status: 'scan-requested' })
        return receipt
      }

      const audio = manifest.destination === 'audio'
      const requestId = `youtube-${receipt.id}`
      const route = audio ? 'animation/resources' : 'animation/background'
      let resource
      if (audio) {
        try {
          resource = await call(`${route}/uploaded-${requestId}`)
        } catch (error) {
          if (error.status !== 404) throw error
        }
      } else if (receipt.resourceId) resource = await call(`${route}/videos/${receipt.resourceId}`)
      if (!resource) {
        await save({ status: 'uploading', requestId })
        resource = await call(`${route}/upload`, { method: 'POST', headers: { 'X-Upload-Request-Id': requestId }, multipart: {
          requestId, title: manifest.title,
          ...(audio ? { kind: manifest.kind, metadata: JSON.stringify(manifest.metadata) } : {}),
          file: { name: path.basename(receipt.file), mimeType: audio ? 'audio/mpeg' : 'video/mp4', buffer: await fs.readFile(receipt.file) },
        } })
      }
      if (resource.roomId !== manifest.roomId) throw new Error('Resource belongs to a different room.')
      await save({ resourceId: resource.id, status: 'preparing' })
      const status = () => audio ? resource.preparation : resource.state
      const deadline = Date.now() + timeout
      while (status() === 'preparing' && Date.now() < deadline) {
        await sleep(500)
        resource = await call(`${route}/${audio ? '' : 'videos/'}${resource.id}`)
      }
      await save({ status: status(), resource })
      if (status() !== 'ready') throw new Error(`Resource ${resource.id}: ${status()}. ${resource.error || resource.reason || 'Resume this receipt to check again.'}`)
      const suffix = audio ? `${route}/${resource.id}/audio` : `${route}/videos/${resource.id}/video`
      const response = await api.get(new URL(`api/${suffix}`, manifest.baseUrl).href)
      if (!response.ok()) throw new Error(`Prepared resource download: HTTP ${response.status()}`)
      const bytes = await response.body()
      const { createHash } = await import('node:crypto')
      if (createHash('sha256').update(bytes).digest('hex') !== resource.checksum) throw new Error('Prepared resource checksum mismatch.')
      await save({ status: 'verified', verifiedAt: new Date().toISOString() })
      return receipt
    } finally { await api.dispose() }
  })
}
