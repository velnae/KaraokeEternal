import { afterEach, expect, it, vi } from 'vitest'
import getLogger from './Log.js'
import { transitionReservationTrace } from './transitionDiagnostics.js'

vi.mock('./Log.js', () => ({ default: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('correlates slow reservations and ignores production and invalid correlation IDs', () => {
  const id = '492449c5-2db3-4fc3-a2d9-f4bcf4645b8d'
  vi.stubEnv('NODE_ENV', 'production')
  expect(transitionReservationTrace(id, 'reserve', 1, 1415)).toBeUndefined()
  vi.stubEnv('NODE_ENV', 'development')
  expect(transitionReservationTrace('arbitrary text', 'reserve', 1, 1415)).toBeUndefined()
  vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1600)
  const complete = transitionReservationTrace(id, 'reserve', 1, 1415)
  expect(complete).toBeTypeOf('function')
  const logger = { warn: vi.fn() }
  vi.mocked(getLogger).mockReturnValue(logger as never)
  complete?.('ready')
  expect(logger.warn).toHaveBeenCalledWith('Diagnostic %s', JSON.stringify({ diagnosticId: id, operation: 'reserve', roomId: 1, queueId: 1415, outcome: 'ready', elapsedMs: 1600 }))
})
