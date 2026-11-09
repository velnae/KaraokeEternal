import type { Middleware } from 'koa'

export const preventDevelopmentCaching: Middleware = async (ctx, next) => {
  const setHeaders = () => {
    ctx.set('Cache-Control', 'no-store')
    ctx.set('Cloudflare-CDN-Cache-Control', 'no-store')
  }
  setHeaders()
  await next()
  // Static middleware can replace cache headers; streaming HMR may already have sent them.
  if (!ctx.headerSent) setHeaders()
}

export const createClientIndex = (urlPath: string, getContent: () => string): Middleware => {
  const routes = [urlPath, ...[
    'account', 'library', 'queue', 'requests', 'player', 'join',
    'admin', 'admin/rooms', 'admin/users', 'admin/playlists', 'admin/account', 'admin/personalization', 'admin/settings/animator',
    'admin/settings/playback', 'admin/settings/files', 'admin/settings/branding', 'admin/settings/moderation',
    'admin/settings/music-blocking', 'admin/settings/display',
    'admin/settings/birthdays',
  ].map(route => `${urlPath}${route}/`)]
  return (ctx, next) => {
    if (!routes.includes(ctx.request.path.replace(/\/?$/, '/'))) return next()
    ctx.set('content-type', 'text/html')
    ctx.body = getContent().replace('<base href="/">', `<base href="${urlPath}">`)
    ctx.status = 200
  }
}
