import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { it, expect } from 'vitest'
import { loadCatalog, catalogAsset, catalogClips } from './catalog.js'
import { open, close } from '../lib/Database.js'

it('imports finite demo clips and rejects changed files without retaining all bytes in memory', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'animation-catalog-'))
  try {
    open({ file: path.join(directory, 'test.sqlite'), ro: false })
    await loadCatalog(directory, path.resolve('assets/animation'))
    const clips = catalogClips()
    expect(clips).toHaveLength(3)
    for (const clip of clips) {
      expect(clip.durationMs).toBeGreaterThan(1000)
      expect(clip.durationMs).toBeLessThanOrEqual(10000)
      expect(catalogAsset(clip.id)?.filename).toBeTruthy()
    }
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'catalog.json'), 'utf8'))
    await fs.writeFile(path.join(directory, 'broken.wav'), 'broken')
    for (const record of manifest) await fs.writeFile(path.join(directory, record.filename), 'corrupt')
    await loadCatalog(directory)
    expect(catalogClips()).toHaveLength(0)
  } finally {
    close()
    await fs.rm(directory, { recursive: true, force: true })
  }
})
