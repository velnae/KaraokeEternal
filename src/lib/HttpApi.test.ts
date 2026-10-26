import { afterEach, expect, it, vi } from 'vitest'
import HttpApi from './HttpApi'

afterEach(() => vi.unstubAllGlobals())

it.each([401, 404, 500])('preserves HTTP status %s so expired identity differs from a temporary failure', async (status) => {
  vi.stubGlobal('document', { baseURI: 'https://example.test/karaoke/' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Request failed', { status })))
  await expect(new HttpApi().get('user')).rejects.toMatchObject({ message: 'Request failed', status })
})

it('returns a valid identity without wrapping the JSON response', async () => {
  vi.stubGlobal('document', { baseURI: 'https://example.test/karaoke/' })
  const user = { userId: 1, tableId: 2 }
  const fetchMock = vi.fn().mockResolvedValue(Response.json(user))
  vi.stubGlobal('fetch', fetchMock)
  expect(await new HttpApi().get('user')).toEqual(user)
  expect(fetchMock).toHaveBeenCalledWith('https://example.test/karaoke/api/user', expect.objectContaining({ credentials: 'same-origin' }))
})
