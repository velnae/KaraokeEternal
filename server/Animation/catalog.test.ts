import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { it, expect } from 'vitest'
import { loadCatalog, catalogAsset, catalogClips } from './catalog.js'

it('loads three finite demo clips, pins bytes and rejects corrupt, escaped and mismatched files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'animation-catalog-'))
  try {
    await loadCatalog(directory, path.resolve('assets/animation'))
    const clips = catalogClips()
    expect(clips).toHaveLength(3)
    for (const clip of clips) {
      expect(clip.durationMs).toBeGreaterThan(1000)
      expect(clip.durationMs).toBeLessThanOrEqual(10000)
      expect(catalogAsset(clip.id)?.bytes.length).toBeGreaterThan(1000)
    }
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'catalog.json'), 'utf8'))
    await fs.writeFile(path.join(directory, 'broken.wav'), 'broken')
    manifest[0].filename = 'broken.wav'
    manifest[1].filename = '../outside.wav'
    manifest[2].checksum = 'bad-checksum'
    await fs.writeFile(path.join(directory, 'catalog.json'), JSON.stringify(manifest))
    await loadCatalog(directory)
    expect(catalogClips()).toHaveLength(0)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
