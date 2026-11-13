export class ProviderError extends Error {
  constructor (message: string, public uncertain: boolean) { super(message) }
}

export type VoiceErrorKind = 'auth' | 'quota' | 'rate' | 'invalid' | 'uncertain' | 'disabled' | 'busy'
export class VoiceError extends Error {
  constructor (message: string, readonly kind: VoiceErrorKind, readonly retryAt = 0, readonly attempted = true) { super(message) }
}
