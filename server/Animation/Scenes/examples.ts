import Queue from '../../Queue/Queue.js'
import Prefs from '../../Prefs/Prefs.js'
import { db } from '../../lib/Database.js'
import { rows, getBirthday, eventAssets, assetDTO } from '../../Birthdays/Store.js'
import { prepareGreetingTransition, planGreetingTransition } from '../../Greetings/transition.js'
import { planCallTransition } from '../Calls/Playback.js'
import { isGreetingAllowed, type Greeting } from '../../../shared/greetings.js'
import { sceneEventFor, type SceneResources, type SceneResource } from '../../../shared/eventScenes.js'

export function sceneExamples (roomId: number) {
  const queue = Object.values(Queue.get(roomId).entities).filter(item => ['APPROVED', 'PLAYING'].includes(item.status)).slice(-30)
  const birthdays = rows(roomId).filter(row => row.preparation === 'ready').slice(0, 20)
  return [...queue.map(item => ({ id: `queue:${item.queueId}`, event: sceneEventFor(item), label: `${item.userDisplayName} · ${item.title}` })),
    ...birthdays.map(row => ({ id: `birthday:${row.id}`, event: 'birthday', label: `Cumpleaños de ${row.name}` }))]
}

/** Reuse prepared resources without submitting work, reserving or recording use. */
export async function sceneExample (roomId: number, id: string) {
  const venue = Prefs.get().branding.name
  const resources: SceneResources = {}
  if (id.startsWith('birthday:')) {
    const row = getBirthday(roomId, id.slice('birthday:'.length))
    if (row.preparation !== 'ready') throw new Error('El cumpleaños todavía no tiene sus audios preparados.')
    for (const asset of eventAssets(row).map(assetDTO)) resources[asset.kind === 'video' ? 'background' : asset.kind] = { ...asset, dimOpacity: 0 }
    return { values: { name: row.name, venue, table: '', song: '', message: '', sender: '' }, resources }
  }
  const queueId = Number(id.replace(/^queue:/, ''))
  const item = Queue.get(roomId).entities[queueId]
  if (!id.startsWith('queue:') || !Number.isSafeInteger(queueId) || !item) throw new Error('El pedido ya no está disponible en esta sala.')
  const prepared = await prepareGreetingTransition(roomId, queueId)
  const stored = db.get<Greeting>('SELECT * FROM greetings WHERE roomId=? AND queueId=?', [roomId, queueId])
  const greeting = stored && isGreetingAllowed(stored) ? stored : null
  const ready = prepared?.assets.map(asset => asset.checksum) ?? []
  const planned = prepared?.call
    ? planCallTransition(roomId, greeting, prepared, ready, 120000, 25000)
    : greeting ? planGreetingTransition(greeting, prepared, ready, 120000, 25000) : null
  for (const asset of planned?.assets ?? []) {
    const slot = asset.role === 'intro' || asset.role === 'call' ? 'announcement' : asset.role === 'bed' ? 'ambience' : asset.role
    const part: SceneResource = { id: asset.id, durationMs: asset.durationMs, url: asset.url, checksum: asset.checksum }
    const previous = resources[slot]
    resources[slot] = previous ? { id: `${slot}-bundle`, durationMs: previous.durationMs + part.durationMs, parts: [...(previous.parts ?? [previous]), part] } : part
  }
  return { values: { name: item.userDisplayName, table: item.tableLabelSnapshot ?? '', song: item.title, venue, message: greeting?.message ?? '', sender: greeting?.sender ?? '' }, resources }
}
