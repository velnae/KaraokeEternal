import getLogger from './lib/Log.js'
import path from 'path'
import getIPAddress from './lib/getIPAddress.js'
import { createClientIndex, preventDevelopmentCaching } from './lib/clientAssets.js'
import http from 'http'
import fs from 'fs'
import { promisify } from 'util'
import parseCookie from './lib/parseCookie.js'
import jsonWebToken from 'jsonwebtoken'
import Koa from 'koa'
import koaRouter from '@koa/router'
import { koaBody } from 'koa-body'
import koaFavicon from 'koa-favicon'
import koaLogger from 'koa-logger'
import koaMount from 'koa-mount'
import koaRange from 'koa-range'
import koaStatic from 'koa-static'
import Media from './Media/Media.js'
import Prefs from './Prefs/Prefs.js'
import libraryRouter from './Library/router.js'
import mediaRouter from './Media/router.js'
import prefsRouter from './Prefs/router.js'
import roomsRouter from './Rooms/router.js'
import userRouter from './User/router.js'
import tablesRouter from './Tables/router.js'
import animationRouter from './Animation/router.js'
import playlistsRouter from './Playlists/router.js'
import { startHousePlaylists } from './Playlists/Playlists.js'
import Animation from './Animation/Animation.js'
import { loadCatalog } from './Animation/catalog.js'
import { startProduction } from './Animation/Production.js'
import localTtsRouter, { startLocalTts } from './Greetings/ttsRouter.js'
import greetingAudioRouter, { startGreetingAudio } from './Greetings/audioRouter.js'
import pushQueuesAndLibrary from './lib/pushQueuesAndLibrary.js'
import { Server as SocketIO } from 'socket.io'
import socketActions from './socket.js'
import IPC from './lib/IPCBridge.js'
import IPCLibraryActions from './Library/ipc.js'
import IPCMediaActions from './Media/ipc.js'
import { SCANNER_WORKER_EXITED, SERVER_WORKER_STATUS, SERVER_WORKER_ERROR } from '../shared/actionTypes.js'

const log = getLogger('server')
const { verify: jwtVerify } = jsonWebToken

async function serverWorker ({ env, startScanner, stopScanner, shutdownHandlers }) {
  const indexFile = path.join(env.KES_PATH_WEBROOT, 'index.html')
  const urlPath = env.KES_URL_PATH.replace(/\/?$/, '/') // force trailing slash
  const jwtKey = Prefs.getJwtKey(env.KES_ROTATE_KEY)
  await loadCatalog(path.join(env.KES_PATH_DATA, 'animation'), path.join(env.KES_PATH_ASSETS, 'animation'))
  const app = new Koa()
  let server, io

  // called when middleware is finalized
  async function createServer () {
    server = http.createServer(app.callback())

    // http server error handler
    server.on('error', function (err) {
      log.error(err.message)

      process.emit('serverWorker', {
        type: SERVER_WORKER_ERROR,
        error: err.message,
      })

      // not much we can do without a working server
      throw err
    })

    // create socket.io server
    io = new SocketIO(server, {
      path: urlPath + 'socket.io',
      serveClient: false,
    })

    // attach socket.io handlers
    const stopAnimation = Animation.initialize(io)
    const stopProduction = await startProduction(path.join(env.KES_PATH_DATA, 'animation'), roomId => Animation.publish(roomId))
    const stopLocalTts = startLocalTts()
    const stopGreetingAudio = startGreetingAudio(path.join(env.KES_PATH_DATA, 'greetings'))
    socketActions(io, jwtKey)
    const stopHousePlaylists = startHousePlaylists(io)

    // attach IPC action handlers
    IPC.use(IPCLibraryActions(io))
    IPC.use(IPCMediaActions(io))

    // success callback in 3rd arg
    server.listen(env.KES_PORT, () => {
      const port = server.address().port
      const url = `http://${getIPAddress()}${port === 80 ? '' : ':' + port}${urlPath}`
      log.info(`Web server running at ${url}`)

      process.emit('serverWorker', {
        type: SERVER_WORKER_STATUS,
        payload: { url },
      })
    })

    // when scanner exits cleanly
    process.on(SCANNER_WORKER_EXITED, ({ code }) => {
      if (code !== 0) return

      Media.cleanup()
      pushQueuesAndLibrary(io)
    })

    // handle shutdown gracefully
    shutdownHandlers.push(async () => {
      stopAnimation()
      stopHousePlaylists()
      await Promise.allSettled([stopGreetingAudio(), stopLocalTts()])
      await stopProduction()
      return new Promise((resolve) => {
      // also calls http server's close method, which ultimately handles the callback
        io.close(resolve)

        // HMR keep-alive connections can prevent http server from fully closing
        server.closeAllConnections()
      })
    })
  }

  // --------------------
  // Begin Koa middleware
  // --------------------

  // server error handler
  app.on('error', (err, ctx) => {
    if (err.code === 'EPIPE') {
      // these are common since browsers make multiple requests for media files
      log.verbose(err.message)
      return
    }

    // silence 4xx response "errors" (koa-logger should show these anyway)
    if (ctx.response && ctx.response.status.toString().startsWith('4')) {
      return
    }

    if (err.stack) log.error(err.stack)
    else log.error(err)
  })

  // middleware error handler
  if (env.NODE_ENV === 'development') app.use(preventDevelopmentCaching)

  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (err) {
      ctx.status = err.status || 500
      ctx.body = err.message
      ctx.app.emit('error', err, ctx)
    }
  })

  // http request/response logging
  app.use(koaLogger((str, args) => (args.length === 6 && args[3] >= 500) ? log.error(str) : log.debug(str)))

  app.use(koaFavicon(path.join(env.KES_PATH_ASSETS, 'favicon.ico')))
  app.use(koaRange)

  // all http requests
  app.use(async (ctx, next) => {
    ctx.jwtKey = jwtKey // used by login route

    // Login/logout also need the previous identity for participation revocation.
    if (!ctx.request.path.startsWith(`${urlPath}api/`)) {
      return next()
    }

    // verify JWT
    try {
      const { keToken } = parseCookie(ctx.request.header.cookie)
      ctx.user = jwtVerify(keToken, jwtKey)
    } catch {
      ctx.user = {
        dateUpdated: null,
        isAdmin: false,
        isGuest: false,
        name: null,
        roomId: null,
        userId: null,
        username: null,
      }
    }

    // validated
    ctx.io = io
    ctx.startScanner = startScanner
    ctx.stopScanner = stopScanner

    await next()
  })

  // Authenticate bounded audio uploads before multipart parsing/storage.
  const parseBody = koaBody({ multipart: true })
  const parseAudio = koaBody({ multipart: true, formidable: { maxFileSize: 20 * 1024 * 1024, maxTotalFileSize: 20 * 1024 * 1024, maxFiles: 1, maxFieldsSize: 64 * 1024 } })
  app.use((ctx, next) => {
    const audioPath = ctx.path.slice(`${urlPath}api/animation/resources/`.length)
    if (ctx.path.startsWith(`${urlPath}api/animation/resources/`) && (audioPath === 'upload' || /^[\w-]+\/replace\/?$/.test(audioPath))) {
      if (!ctx.user?.isAdmin || !Number.isInteger(ctx.user.roomId)) ctx.throw(403)
      return parseAudio(ctx, next)
    }
    return parseBody(ctx, next)
  })

  // http api endpoints
  const baseRouter = new koaRouter({
    prefix: urlPath.replace(/\/$/, ''), // avoid double slashes with /api prefix
  })

  baseRouter.use(libraryRouter.routes())
  baseRouter.use(mediaRouter.routes())
  baseRouter.use(prefsRouter.routes())
  baseRouter.use(localTtsRouter.routes())
  baseRouter.use(greetingAudioRouter.routes())
  baseRouter.use(roomsRouter.routes())
  baseRouter.use(userRouter.routes())
  baseRouter.use(tablesRouter.routes())
  baseRouter.use(animationRouter.routes())
  baseRouter.use(playlistsRouter.routes())
  app.use(baseRouter.routes())

  if (env.NODE_ENV !== 'development') {
    // make sure we handle index.html before koaStatic,
    // otherwise it'll be served without dynamic base tag
    const indexContent = await promisify(fs.readFile)(indexFile, 'utf8')
    app.use(createClientIndex(urlPath, () => indexContent))

    // serve build and asset folders
    app.use(koaMount(urlPath, koaStatic(env.KES_PATH_WEBROOT)))
    app.use(koaMount(`${urlPath}assets`, koaStatic(env.KES_PATH_ASSETS)))

    await createServer()
    return
  }

  // ----------------------
  // Development middleware
  // ----------------------
  log.info('Enabling webpack dev and HMR middleware')
  const { default: webpack } = await import('webpack')
  // eslint-disable-next-line n/no-missing-import
  const { default: webpackConfig } = await import('../config/webpack.config.js')
  const compiler = webpack(webpackConfig)
  let indexContent = ''

  compiler.hooks.done.tapPromise('indexPlugin', async () => {
    indexContent = await new Promise<string>((resolve, reject) => {
      compiler.outputFileSystem.readFile(indexFile, 'utf8', (err, result) => {
        if (err) return reject(err)
        return resolve(String(result))
      })
    })

    if (!server) {
      app.use(createClientIndex(urlPath, () => indexContent))
      await createServer()
    }
  })

  const { default: webpackDevMiddleware } = await import('webpack-dev-middleware')
  // Let createClientIndex apply the configured base path instead of serving raw HTML.
  app.use(webpackDevMiddleware.koaWrapper(compiler, { publicPath: urlPath, index: false }))

  const { default: hotMiddleware } = await import('./lib/getHotMiddleware.js')
  app.use(hotMiddleware(compiler))

  // serve assets since webpack-dev-server is unaware of this folder
  app.use(koaMount(`${urlPath}assets`, koaStatic(env.KES_PATH_ASSETS)))
}

export default serverWorker
