import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
const scenarios = { 'transitions': 'config/transition-player.e2e.mjs', 'delayed-ack': 'config/youtube-preparation.e2e.mjs',
  'late-playback-receipt': 'config/youtube-preparation.e2e.mjs', 'slow-link': 'config/youtube-preparation.e2e.mjs' }
const maxBytes = 2 * 1024 * 1024
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readJSON = (file) => {
  if (fs.statSync(file).size > maxBytes) throw new Error('Evidence exceeds 2 MiB')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })

export function validateWindow (since, until) {
  const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/
  const elapsed = Date.parse(until) - Date.parse(since)
  if (!iso.test(since) || !iso.test(until) || !Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 3600000) {
    throw new Error('Use UTC ISO timestamps with a positive window of at most one hour')
  }
}

export function sanitizePlayer (value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.events) || value.events.length > 300) throw new Error('Invalid playback trace')
  const numbers = ['sequence', 'wallTime', 'monotonicMs', 'channelId', 'runId', 'roomId', 'queueId', 'durationMs', 'elapsedMs', 'audioElapsedMs', 'playerEpoch', 'volume', 'remainingMs']
  const strings = ['event', 'reason', 'state', 'interventionId', 'checksum']
  const events = value.events.map((event) => {
    if (!event || typeof event.event !== 'string' || !Number.isFinite(event.sequence) || !Number.isFinite(event.monotonicMs)) throw new Error('Invalid trace event')
    const clean = {}
    for (const key of numbers) if (Number.isFinite(event[key])) clean[key] = event[key]
    for (const key of strings) {
      if (typeof event[key] === 'string' && /^[\w:/.-]{1,128}$/.test(event[key])) clean[key] = event[key]
    }
    if (!clean.event) throw new Error('Invalid event name')
    return clean
  })
  return { schemaVersion: 1, capturedAt: Number(value.capturedAt) || null, timeOrigin: Number(value.timeOrigin) || null,
    droppedEvents: Number(value.droppedEvents) || 0, events }
}

export function reproductionEnvironment (mode, scenario, traceFile) {
  if (!['development', 'production'].includes(mode)) throw new Error('Mode must be development or production')
  if (!Object.hasOwn(scenarios, scenario)) throw new Error('Unknown scenario')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KARAOKE_|KES_|DEV_PLAYER_|NODE_OPTIONS)/.test(key)))
  return { ...env, KARAOKE_E2E_MODE: mode, KARAOKE_E2E_HTTPS_UI: '0', KARAOKE_E2E_REAL_YOUTUBE: '0',
    KARAOKE_E2E_TRANSITION_ONLY: '1',
    KARAOKE_E2E_DELAYED_ACKS: scenario === 'delayed-ack' ? '1' : '0', KARAOKE_DIAGNOSTIC_TRACE: traceFile,
    KARAOKE_E2E_LATE_PLAYBACK_RECEIPTS: scenario === 'late-playback-receipt' ? '1' : '0',
    KARAOKE_E2E_SLOW_LINK: scenario === 'slow-link' ? '1' : '0',
    KES_HOST: '127.0.0.1', KES_ELEVENLABS_API_KEY: '', KES_YOUTUBE_API_KEY: '', KES_GEMINI_API_KEY: '' }
}

function addEvidence (directory, kind, value) {
  const name = `${kind}-${randomUUID()}.json`
  writeJSON(path.join(directory, name), value)
  return name
}

export function main (argv) {
  const [command, directory, ...args] = argv
  if (!command || command === 'help') {
    console.log(`Usage: node config/diagnostics/cli.js <command> <bundle> [arguments]
  init <bundle> <symptom> <expected behavior>
  inspect-release <bundle>
  collect-server <bundle> <since UTC ISO> <until UTC ISO> <roomId> --production-read
  import-player <bundle> <trace.json>
  assemble <bundle> <transitions|delayed-ack|late-playback-receipt|slow-link>
  run <bundle> <development|production>
  report <bundle>`)
    return
  }
  if (!directory) throw new Error('Bundle directory required')
  if (command === 'init') {
    if (args.length !== 2 || args.some(value => !value.trim() || value.length > 1000)) throw new Error('Provide symptom and expected behavior (max 1000 characters each)')
    fs.mkdirSync(directory, { mode: 0o700 })
    writeJSON(path.join(directory, 'manifest.json'), { schemaVersion: 1, id: randomUUID(), createdAt: new Date().toISOString(), symptom: args[0], expected: args[1] })
    return
  }
  const manifest = readJSON(path.join(directory, 'manifest.json'))
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported bundle version')
  switch (command) {
    case 'inspect-release': {
      const git = (...gitArgs) => {
        const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8', timeout: 10000 })
        if (result.status !== 0) throw new Error('Could not inspect local Git version')
        return result.stdout.trim()
      }
      const files = ['package.json', 'src/routes/Player/components/Animation/useAnimationPlayer.ts', 'src/routes/Player/components/Animation/AnnouncementAudio.ts']
      console.log(addEvidence(directory, 'local-release', { commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
        fingerprints: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) }))
      break
    }
    case 'collect-server': {
      const [since, until, room, permission] = args
      validateWindow(since, until)
      if (!/^[1-9]\d{0,8}$/.test(room) || permission !== '--production-read' || args.length !== 4) throw new Error('Room and explicit --production-read required')
      const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'karaoke', 'python3', '-',
        '/var/www/vhosts/karaoke.puyu.pe', since, until, room], {
        input: fs.readFileSync(path.join(root, 'config/diagnostics/collect-server.py')), encoding: 'utf8', timeout: 45000, maxBuffer: maxBytes,
      })
      if (result.status !== 0) throw new Error('SSH collection failed; verify access as karaoke (no sudo fallback)')
      const evidence = JSON.parse(result.stdout)
      // Journals are private evidence, not guaranteed anonymous. Mask common credentials.
      if (evidence.journal) evidence.journal = (Array.isArray(evidence.journal) ? evidence.journal : evidence.journal.split('\n'))
        .map(line => line.replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
          .replace(/((?:password|token|secret|api[_-]?key|cookie)\s*[=:]\s*)\S+/gi, '$1[REDACTED]'))
      console.log(addEvidence(directory, 'server', evidence))
      break
    }
    case 'import-player':
      console.log(addEvidence(directory, 'player', sanitizePlayer(readJSON(args[0]))))
      break
    case 'assemble': {
      if (!Object.hasOwn(scenarios, args[0])) throw new Error('Choose transitions, delayed-ack, late-playback-receipt or slow-link')
      writeJSON(path.join(directory, 'reproduction.json'), { schemaVersion: 1, scenario: args[0], fidelity: 'synthetic-scenario',
        limitation: 'Exercises the selected contract; does not automatically replay the incident, production data or network timings.' })
      break
    }
    case 'run': {
      const fixture = readJSON(path.join(directory, 'reproduction.json'))
      if (fixture.schemaVersion !== 1) throw new Error('Unsupported reproduction version')
      const runId = randomUUID()
      const trace = path.resolve(directory, `reproduction-trace-${runId}.json`)
      const env = reproductionEnvironment(args[0], fixture.scenario, trace)
      const logFile = path.join(directory, `run-${runId}.log`)
      const log = fs.openSync(logFile, 'wx', 0o600)
      let result
      try {
        result = spawnSync(process.execPath, [scenarios[fixture.scenario]], { cwd: root, env, detached: true,
          stdio: ['ignore', log, log], timeout: 600000, killSignal: 'SIGTERM' })
        if (result.error && result.pid) {
          // The timed-out suite cannot run its finally; terminate its isolated group.
          try {
            process.kill(-result.pid, 'SIGTERM')
          } catch { /* Group already exited. */ }
        }
      } finally { fs.closeSync(log) }
      let traceCaptured = false
      if (fs.existsSync(trace)) {
        try {
          traceCaptured = sanitizePlayer(readJSON(trace)).events.length > 0
        } catch { /* Missing/invalid evidence is a failed diagnostic run. */ }
      }
      const outcome = { schemaVersion: 1, scenario: fixture.scenario, mode: args[0], exitCode: result.status,
        signal: result.signal, error: result.error?.message, passed: result.status === 0 && traceCaptured, traceCaptured,
        log: path.basename(logFile), trace: fs.existsSync(trace) ? path.basename(trace) : null,
        incidentReproduced: 'not-established', completedAt: new Date().toISOString() }
      console.log(addEvidence(directory, 'run', outcome))
      if (!outcome.passed) process.exitCode = 1
      break
    }
    case 'report': {
      const evidence = fs.readdirSync(directory).filter(name => /^(player|server|local-release|run|reproduction-trace)-.*\.json$/.test(name))
      const records = evidence.map(name => ({ file: name, sha256: hash(fs.readFileSync(path.join(directory, name))), data: readJSON(path.join(directory, name)) }))
      console.log(JSON.stringify({ manifest, records, conclusion: 'Evidence only. A passing synthetic scenario does not establish incident reproduction.' }, null, 2))
      break
    }
    default: throw new Error('Unknown command; use help')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
