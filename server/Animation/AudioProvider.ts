import type { ProviderCapabilities } from '../../shared/audioCatalog.js'
import type { ProductionConfig } from '../../shared/catalogProduction.js'
import type { AudioKind } from '../../shared/animation.js'

export interface AudioProvider {
  capabilities: ProviderCapabilities
  check(model: string, kind?: AudioKind): Promise<{ voiceId: string, name: string }[]>
  generate(config: ProductionConfig, signal?: AbortSignal): Promise<{ bytes: Buffer, requestId: string | null }>
}
