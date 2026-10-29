import fs from 'node:fs'
import path from 'node:path'
import { db } from '../lib/Database.js'
import { catalogChanged, catalogRoot } from './catalog.js'
import { getResource } from './Resources.js'
import getLogger from '../lib/Log.js'

export function deleteResource (roomId: number, id: string) {
  const row = getResource(id, roomId)
  if (!row || (row.roomId !== null && row.roomId !== roomId)) throw new Error('Este audio no está disponible o pertenece a otra sala.')
  const jobId = id.startsWith('generated-') ? id.slice('generated-'.length) : ''
  const job = db.get<{ status: string }>('SELECT status FROM catalogGenerationJobs WHERE jobId=? AND roomId=?', [jobId, roomId])
  if (['queued', 'generating', 'preparing'].includes(row.preparation) || ['queued', 'generating', 'publishing'].includes(job?.status ?? '')) throw new Error('El audio sigue en preparación. Espere a que termine e intente de nuevo.')
  const now = Date.now()
  const intervention = db.get(`SELECT interventionId FROM animationInterventions WHERE roomId=?
    AND (status IN ('PENDING','RESERVED','PLAYING') OR leaseUntil>?)
    AND (clipId=? OR EXISTS(SELECT 1 FROM json_each(sequenceJSON) WHERE json_extract(value,'$.id')=?))`, [roomId, now, id, id])
  const ambience = db.get(`SELECT roomId FROM animationRoomState WHERE roomId=?
    AND json_extract(ambienceJSON,'$.clip.id')=? AND json_extract(ambienceJSON,'$.until')>?`, [roomId, id, now])
  if (intervention || ambience) throw new Error('El audio está en uso o tiene un anuncio pendiente. Deténgalo o cancele el anuncio y vuelva a intentar.')

  if (row.roomId === null) {
    // Included files remain available to other rooms, but cannot reappear here.
    db.run('INSERT INTO audioRoomDeletions(roomId,resourceId,deletedAt) VALUES(?,?,?)', [roomId, id, now])
    catalogChanged()
    return
  }

  const root = fs.realpathSync(catalogRoot())
  const filename = row.filename ? path.resolve(root, row.filename) : null
  if (filename && !filename.startsWith(root + path.sep)) throw new Error('Archivo fuera del catálogo.')
  const references = db.all<{ filename: string }>(`SELECT filename FROM audioResources WHERE id!=? AND deletedAt IS NULL AND filename IS NOT NULL
    UNION ALL SELECT filename FROM catalogGenerationJobs WHERE jobId!=? AND filename IS NOT NULL`, [id, jobId])
  const shared = filename && references.some(reference => path.resolve(root, reference.filename) === filename)
  let quarantine: string | null = null
  // A short synchronous transaction prevents reservations between the check and removal.
  db.exec('SAVEPOINT delete_audio')
  try {
    if (filename && !shared && fs.existsSync(filename)) {
      if (!fs.realpathSync(filename).startsWith(root + path.sep)) throw new Error('Archivo fuera del catálogo.')
      quarantine = `${filename}.deleted-${id}`
      fs.renameSync(filename, quarantine)
    }
    // Keep a tombstone and production/usage history so startup cannot reimport the file.
    db.run('UPDATE audioResources SET deletedAt=?,updatedAt=?,filename=NULL WHERE id=?', [now, now, id])
    db.run('UPDATE catalogGenerationJobs SET filename=NULL,generationKey=\'deleted:\' || jobId WHERE jobId=? AND roomId=?', [jobId, roomId])
    db.exec('RELEASE delete_audio')
  } catch (error) {
    db.exec('ROLLBACK TO delete_audio')
    db.exec('RELEASE delete_audio')
    if (quarantine) fs.renameSync(quarantine, filename!)
    throw error
  }
  if (quarantine) {
    try {
      fs.rmSync(quarantine, { force: true })
    } catch (error) {
      getLogger('animation').error('Could not remove retired audio %s: %s', id, (error as Error).message)
    }
  }
  catalogChanged()
}
