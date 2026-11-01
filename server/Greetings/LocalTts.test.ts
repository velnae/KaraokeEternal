import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import LocalTts from './LocalTts.js'
import { readTtsStatus } from './TtsClient.js'
import { defaultLocalTtsConfig, type LocalTtsConfig } from '../../shared/localTts.js'

const directories: string[] = []
const services: LocalTts[] = []
const servers: Server[] = []
const connections = new Set<Socket>()
const timing = { waitingMs: 20, timeoutMs: 1000, startupMs: 3000, retryMs: 20 }
const ready = (socket: Socket) => socket.end(JSON.stringify({ ok: true, result: { status: 'ready', pid: process.pid } }) + '\n')

async function installation () {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ke-tts-'))
  directories.push(directory)
  await fs.mkdir(path.join(directory, '.tmp'))
  await fs.mkdir(path.join(directory, '.venv/bin'), { recursive: true })
  await fs.symlink(process.execPath, path.join(directory, '.venv/bin/python'))
  await fs.writeFile(path.join(directory, 'resident.py'), '# Fixture contract marker\n')
  await fs.writeFile(path.join(directory, 'speak.py'), '# Fixture contract marker\n')
  await fs.writeFile(path.join(directory, 'worker.mjs'), `
    import { createServer } from 'node:net';
    const server = createServer(socket => socket.once('data', () => socket.end(JSON.stringify({ ok: true, result: { status: 'ready', pid: process.pid } }) + '\\n')));
    server.on('error', () => process.exit(1));
    setTimeout(() => server.listen('.tmp/model.sock'), 80);
  `)
  await fs.writeFile(path.join(directory, 'model.sh'), `#!/bin/bash\nexec '${process.execPath}' worker.mjs\n`)
  return directory
}

async function worker (directory: string, respond: (socket: Socket) => void = ready) {
  const server = createServer((socket) => {
    connections.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => connections.delete(socket))
    socket.once('data', (data) => {
      expect(JSON.parse(data.toString())).toEqual({ action: 'status' })
      respond(socket)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(path.join(directory, '.tmp/model.sock'), resolve))
  return server
}

function service (installationPath = '', persist: (config: LocalTtsConfig) => void = () => {}, time = timing) {
  const instance = new LocalTts({ ...defaultLocalTtsConfig, installationPath }, persist, time)
  services.push(instance)
  return instance
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(instance => instance.close()))
  for (const socket of connections) socket.destroy()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('local TTS configuration and resident lifecycle', () => {
  it('validates installations before persisting, supports spaces and rejects stale writes', async () => {
    const directory = await installation()
    const renamed = `${directory} space`
    await fs.rename(directory, renamed)
    directories.push(renamed)
    const saved: LocalTtsConfig[] = []
    const instance = service('', config => saved.push(config))
    await expect(instance.configure({ ...defaultLocalTtsConfig, installationPath: '/missing/chatterbox' })).rejects.toThrow('instalación accesible')
    expect(saved).toHaveLength(0)
    await instance.configure({ ...defaultLocalTtsConfig, installationPath: renamed })
    await expect.poll(() => instance.snapshot().state).toBe('unavailable')
    expect(saved[0]).toEqual({ installationPath: renamed, autoStart: false, revision: 1 })
    await expect(instance.configure({ ...defaultLocalTtsConfig, installationPath: renamed })).rejects.toMatchObject({ status: 409 })
    expect(saved).toHaveLength(1)
    expect(instance.snapshot().config.revision).toBe(1)
  })

  it('keeps one probe while the external worker is busy and switches only after its reply', async () => {
    const first = await installation()
    const second = await installation()
    let held: Socket | undefined
    let calls = 0
    await worker(first, (socket) => {
      calls++
      held = socket
    })
    await worker(second)
    const saved: LocalTtsConfig[] = []
    const instance = service(first, config => saved.push(config))
    instance.check()
    await expect.poll(() => instance.snapshot().state).toBe('busy')
    instance.check()
    instance.check(true)
    await instance.configure({ ...defaultLocalTtsConfig, installationPath: second })
    expect(instance.snapshot()).toMatchObject({ activePath: first, pending: true, managed: false })
    expect(calls).toBe(1)
    ready(held!)
    await expect.poll(() => instance.snapshot()).toMatchObject({ state: 'ready', activePath: second, pending: false })
    expect(saved[0].installationPath).toBe(second)
    await instance.close()
    expect(servers.every(server => server.listening)).toBe(true)
  })

  it('does not apply a pending path change after a timeout or mislabel it as ready', async () => {
    const first = await installation()
    const second = await installation()
    await worker(first, () => {})
    const instance = service(first, () => {}, { ...timing, timeoutMs: 100 })
    instance.check()
    await expect.poll(() => instance.snapshot().state, { interval: 5 }).toBe('busy')
    await instance.configure({ ...defaultLocalTtsConfig, installationPath: second, autoStart: true })
    await expect.poll(() => instance.snapshot().state).toBe('error')
    expect(instance.snapshot()).toMatchObject({ activePath: first, pending: true, managed: false })
  })

  it('starts only one owned process and releases that exact child on shutdown', async () => {
    const directory = await installation()
    const instance = service(directory)
    instance.check(true)
    instance.check(true)
    await expect.poll(() => instance.snapshot().state, { timeout: 4000 }).toBe('ready')
    const { pid } = instance.snapshot()
    expect(instance.snapshot().managed).toBe(true)
    expect(pid).not.toBe(process.pid)
    instance.check(true)
    await expect.poll(() => instance.snapshot().state).toBe('ready')
    expect(instance.snapshot().pid).toBe(pid)
    await instance.close()
    expect(() => process.kill(pid!, 0)).toThrow()
  })

  it('reuses an external process even when automatic startup is configured', async () => {
    const directory = await installation()
    await worker(directory)
    const instance = new LocalTts({ installationPath: directory, autoStart: true, revision: 4 }, () => {}, timing)
    services.push(instance)
    instance.initialize()
    await expect.poll(() => instance.snapshot().state).toBe('ready')
    expect(instance.snapshot()).toMatchObject({ managed: false, pid: process.pid })
    await instance.close()
    expect(servers[0].listening).toBe(true)
  })

  it('reports an invalid stored installation without blocking initialization', async () => {
    const instance = new LocalTts({ installationPath: '/missing/model', autoStart: true, revision: 2 }, () => {}, timing)
    services.push(instance)
    instance.initialize()
    await expect.poll(() => instance.snapshot().state).toBe('error')
    expect(instance.snapshot().message).toContain('Revise la ruta')
  })
})

describe('resident status protocol', () => {
  const probe = (directory: string, controller = new AbortController()) => readTtsStatus(directory, { ...timing, signal: controller.signal, onWaiting: () => {} })

  it('accepts a fragmented newline-delimited response', async () => {
    const directory = await installation()
    await worker(directory, (socket) => {
      socket.write('{"ok":true,"result":')
      setTimeout(() => socket.end(`{"status":"ready","pid":${process.pid}}}\n`), 10)
    })
    expect(await probe(directory)).toBe(process.pid)
  })

  it.each([
    ['invalid JSON', 'not json\n'],
    ['non-ready worker', '{"ok":true,"result":{"status":"stopping","pid":42}}\n'],
    ['oversized frame', 'x'.repeat(4097)],
  ])('rejects an incompatible response: %s', async (_name, response) => {
    const directory = await installation()
    await worker(directory, socket => socket.end(response))
    await expect(probe(directory)).rejects.toMatchObject({ code: 'PROTOCOL' })
  })

  it('aborts an unanswered request and closes its connection', async () => {
    const directory = await installation()
    let held: Socket | undefined
    await worker(directory, (socket) => {
      held = socket
    })
    const controller = new AbortController()
    const result = probe(directory, controller)
    const rejection = expect(result).rejects.toMatchObject({ code: 'ABORTED' })
    await expect.poll(() => !!held).toBe(true)
    controller.abort()
    await rejection
    await expect.poll(() => held!.destroyed).toBe(true)
  })
})
