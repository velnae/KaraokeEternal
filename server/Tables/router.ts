import Router from '@koa/router'
import Tables from './Tables.js'
import { db } from '../lib/Database.js'
import { enforceConnectedParticipants } from './admission.js'

const router = new Router({ prefix: '/api' })
router.post('/table-join/resolve', (ctx) => {
  ctx.set('Cache-Control', 'no-store')
  try {
    ctx.body = Tables.resolve((ctx.request as unknown as { body: Record<string, unknown> }).body.invitation)
  } catch (error) {
    ctx.throw(422, (error as Error).message)
  }
})

router.use('/rooms/:roomId/tables', async (ctx, next) => {
  if (!ctx.user?.isAdmin) ctx.throw(403)
  ctx.set('Cache-Control', 'no-store')
  try {
    await next()
  } catch (error) {
    ctx.throw((error as { status?: number }).status ?? 422, (error as Error).message)
  }
})
router.get('/rooms/:roomId/tables', (ctx) => {
  ctx.body = Tables.list(Number(ctx.params.roomId))
})
router.post('/rooms/:roomId/tables', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Tables.save(roomId, undefined, (ctx.request as unknown as { body: Record<string, unknown> }).body)
  ctx.body = Tables.list(roomId)
})
router.put('/rooms/:roomId/tables/:tableId', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  Tables.save(roomId, Number(ctx.params.tableId), (ctx.request as unknown as { body: Record<string, unknown> }).body)
  enforceConnectedParticipants(ctx.io)
  ctx.body = Tables.list(roomId)
})
router.get('/rooms/:roomId/tables/:tableId/qr', (ctx) => {
  ctx.body = { invitation: Tables.credential(Number(ctx.params.roomId), Number(ctx.params.tableId)) }
})
router.post('/rooms/:roomId/tables/:tableId/renew-qr', (ctx) => {
  ctx.body = { invitation: Tables.credential(Number(ctx.params.roomId), Number(ctx.params.tableId), true) }
})
router.post('/rooms/:roomId/tables/:tableId/close-sessions', (ctx) => {
  const roomId = Number(ctx.params.roomId)
  const tableId = Number(ctx.params.tableId)
  Tables.get(roomId, tableId)
  db.run('UPDATE participantSessions SET revokedAt = ? WHERE tableId = ? AND revokedAt IS NULL', [Math.floor(Date.now() / 1000), tableId])
  enforceConnectedParticipants(ctx.io)
  ctx.body = Tables.list(roomId)
})
export default router
