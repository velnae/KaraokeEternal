import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { main, reproductionEnvironment, sanitizePlayer, validateWindow } from './cli.js'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('assembles a private, non-overwriting bundle and reports evidence', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-test-'))
  directories.push(parent)
  const bundle = path.join(parent, 'incident')
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  main(['init', bundle, 'Voice stops early', 'Voice completes before music'])
  expect(fs.statSync(bundle).mode & 0o777).toBe(0o700)
  expect(fs.statSync(path.join(bundle, 'manifest.json')).mode & 0o777).toBe(0o600)
  main(['inspect-release', bundle])
  main(['assemble', bundle, 'transitions'])
  expect(() => main(['assemble', bundle, 'delayed-ack'])).toThrow()
  main(['report', bundle])
  const report = JSON.parse(log.mock.calls.at(-1)[0])
  expect(report.records[0].data.commit).toMatch(/^[a-f0-9]{40}$/)
  expect(report.records[0].sha256).toHaveLength(64)
  expect(() => main(['init', bundle, 'overwrite', 'overwrite'])).toThrow()
})

it('imports only bounded technical evidence, not credentials or arbitrary payloads', () => {
  const trace = sanitizePlayer({ schemaVersion: 1, cookies: 'private', events: [
    { event: 'audio-finish', sequence: 1, monotonicMs: 42, reason: 'socket-disconnected', password: 'private', checksum: 'abc', state: 'STOPPED' },
  ] })
  expect(JSON.stringify(trace)).not.toContain('private')
  expect(trace.events[0].reason).toBe('socket-disconnected')
  expect(() => sanitizePlayer({ schemaVersion: 1, events: Array(301).fill({}) })).toThrow()
  expect(() => sanitizePlayer({ schemaVersion: 2, events: [] })).toThrow()
})

it('rejects unbounded or shell-injected production collection before accessing SSH', () => {
  expect(() => validateWindow('2026-11-08T10:00:00Z', '2026-11-08T10:15:00Z')).not.toThrow()
  for (const until of ['2026-11-08T12:00:00Z', '2026-11-08T09:00:00Z', 'now; touch /tmp/no']) {
    expect(() => validateWindow('2026-11-08T10:00:00Z', until)).toThrow()
  }
})

it('cannot inherit shared HTTPS mode, external fixtures or provider secrets into reproduction', () => {
  vi.stubEnv('KARAOKE_E2E_HTTPS_UI', '1')
  vi.stubEnv('KARAOKE_E2E_VOICE_FILE', '/private/voice.wav')
  vi.stubEnv('KES_DATA', '/production')
  vi.stubEnv('KES_ELEVENLABS_API_KEY', 'private')
  const env = reproductionEnvironment('development', 'delayed-ack', '/tmp/trace.json')
  expect(env.KARAOKE_E2E_HTTPS_UI).toBe('0')
  expect(env.KARAOKE_E2E_DELAYED_ACKS).toBe('1')
  expect(env).not.toHaveProperty('KARAOKE_E2E_VOICE_FILE')
  expect(env).not.toHaveProperty('KES_DATA')
  expect(env.KES_ELEVENLABS_API_KEY).toBe('')
  expect(reproductionEnvironment('development', 'late-playback-receipt', '/tmp/trace.json').KARAOKE_E2E_LATE_PLAYBACK_RECEIPTS).toBe('1')
  expect(() => reproductionEnvironment('development', '../../script', '')).toThrow()
  expect(() => reproductionEnvironment('live', 'transitions', '')).toThrow()
})
