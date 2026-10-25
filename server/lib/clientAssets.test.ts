import { expect, it, vi } from 'vitest'
import type { Context } from 'koa'
import { createClientIndex, preventDevelopmentCaching } from './clientAssets.js'

const context = (path = '/') => ({ request: { path }, set: vi.fn(), headerSent: false, body: '', status: 404 })

it('serves the latest build after a rebuild and preserves the configured base path', async () => {
  let html = '<base href="/"><script src="main.old.js"></script>'
  const middleware = createClientIndex('/karaoke/', () => html)
  const ctx = context('/karaoke/player')
  await middleware(ctx as unknown as Context, vi.fn())
  expect(ctx.body).toBe('<base href="/karaoke/"><script src="main.old.js"></script>')
  html = '<base href="/"><script src="main.new.js"></script>'
  ctx.request.path = '/karaoke/requests/'
  await middleware(ctx as unknown as Context, vi.fn())
  expect(ctx.body).toBe('<base href="/karaoke/"><script src="main.new.js"></script>')
  expect(ctx.status).toBe(200)
})

it('does not replace API or asset responses with the application index', async () => {
  const middleware = createClientIndex('/', () => 'index')
  for (const path of ['/api/rooms', '/main.abc.js', '/unknown']) {
    const ctx = context(path)
    const next = vi.fn()
    await middleware(ctx as unknown as Context, next)
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.body).toBe('')
  }
})

it('prevents browser and CDN caching even when downstream middleware replaces headers', async () => {
  const ctx = context()
  await preventDevelopmentCaching(ctx as unknown as Context, async () => {
    ctx.set('Cache-Control', 'public, max-age=14400')
  })
  expect(ctx.set.mock.calls.slice(-2)).toEqual([
    ['Cache-Control', 'no-store'],
    ['Cloudflare-CDN-Cache-Control', 'no-store'],
  ])
})

it('sets cache policy before streaming and never writes headers after they are sent', async () => {
  const ctx = context()
  await preventDevelopmentCaching(ctx as unknown as Context, async () => {
    expect(ctx.set).toHaveBeenCalledWith('Cloudflare-CDN-Cache-Control', 'no-store')
    ctx.headerSent = true
  })
  expect(ctx.set).toHaveBeenCalledTimes(2)
})
