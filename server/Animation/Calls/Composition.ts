import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseBuffer } from 'music-metadata'
import { prepareAudio, AudioValidationError } from '../AudioPreparation.js'

const run = promisify(execFile)
export const compositionRevision = 1
export const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export async function preparedPart (directory: string, bytes: Buffer, ffmpeg: string, signal: AbortSignal) {
  const id = randomUUID()
  const raw = path.join(directory, `${id}.input`)
  const master = `masters/${id}.wav`
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AudioValidationError('El audio supera el tamaño permitido.')
  const info = await parseBuffer(bytes).catch(() => null)
  if (info?.format.container?.toLowerCase() !== 'wave' || !info.format.duration || info.format.duration > 10) {
    throw new AudioValidationError('La pieza debe ser WAV y durar como máximo 10 segundos. Acorte el texto.')
  }
  await fs.mkdir(path.join(directory, 'masters'), { recursive: true })
  let prepared: Awaited<ReturnType<typeof prepareAudio>> | undefined
  try {
    await fs.writeFile(raw, bytes)
    // Trim only outer silence, never internal pauses. Retain 40 ms at each edge.
    const edge = 'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB:start_silence=0.04'
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'wav', '-i', raw,
      '-af', `${edge},afade=t=in:d=0.005,areverse,${edge},afade=t=in:d=0.005,areverse,loudnorm=I=-16:TP=-1:LRA=7`,
      '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', path.join(directory, master)],
    { signal, timeout: 45000, maxBuffer: 16384 })
    const canonical = await fs.readFile(path.join(directory, master))
    prepared = await prepareAudio(directory, id, 'voice', canonical, ffmpeg, signal)
    return { id, master, masterChecksum: checksum(canonical), ...prepared }
  } catch (error) {
    await fs.rm(path.join(directory, master), { force: true })
    if (prepared) await fs.rm(path.join(directory, prepared.filename), { force: true })
    throw error
  } finally { await fs.rm(raw, { force: true }) }
}

export async function compose (directory: string, masters: Buffer[], ffmpeg: string, signal: AbortSignal) {
  const attempt = await fs.mkdtemp(path.join(directory, '.compose-'))
  try {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y']
    for (const [index, bytes] of masters.entries()) {
      const file = path.join(attempt, `${index}.wav`)
      await fs.writeFile(file, bytes)
      args.push('-f', 'wav', '-i', file)
    }
    const file = path.join(attempt, 'complete.wav')
    // Silence remains intentional at grammatical boundaries; spoken samples never overlap.
    args.push('-filter_complex', '[0:a]apad=pad_dur=0.10[a];[1:a]apad=pad_dur=0.06[b];[a][b][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', file)
    await run(ffmpeg, args, { signal, timeout: 45000, maxBuffer: 16384 })
    return await preparedPart(directory, await fs.readFile(file), ffmpeg, signal)
  } finally { await fs.rm(attempt, { recursive: true, force: true }) }
}
