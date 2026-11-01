import { createHash } from 'node:crypto'
import type { ProductionConfig } from '../../shared/catalogProduction.js'
import { effectCategoryValue } from '../../shared/effectCategories.js'

function canonical (value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

// Legacy ElevenLabs defaults and omitted optional fields describe the same request.
export function generationKey (roomId: number, config: ProductionConfig) {
  const providerId = config.providerId ?? 'elevenlabs'
  const normalized = { ...config, providerId, category: (config.kind === 'effect' ? effectCategoryValue(config.category) : config.category) || undefined,
    effectType: config.effectType === 'short' ? undefined : config.effectType,
    celebrationMode: config.celebrationMode === 'confirmed' ? undefined : config.celebrationMode,
    language: config.kind === 'voice' && providerId === 'elevenlabs' ? config.language || 'es' : config.language,
    loop: config.kind === 'ambience' && providerId === 'elevenlabs' ? config.loop ?? true : config.loop }
  return createHash('sha256').update(`${roomId}:${JSON.stringify(canonical(normalized))}`).digest('hex')
}
