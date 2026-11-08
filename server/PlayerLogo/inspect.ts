import { PLAYER_LOGO_LIMITS as limits, type PlayerLogoKind } from '../../shared/playerLogo.js'

const invalid = () => new Error('La imagen está incompleta o no es un PNG/GIF válido.')

export function inspectLogoImage (bytes: Buffer, kind: PlayerLogoKind) {
  if (!bytes.length || bytes.length > (kind === 'png' ? limits.pngBytes : limits.gifBytes)) throw new Error(`Seleccione un ${kind.toUpperCase()} de hasta ${kind === 'png' ? 5 : 8} MiB.`)
  if (kind === 'png') {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.subarray(-12).toString('hex') !== '0000000049454e44ae426082') throw invalid()
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    if (!width || !height || width > limits.pngDimension || height > limits.pngDimension) throw new Error('El PNG debe medir como máximo 2048 × 2048 píxeles.')
    return { width, height, frames: 1, durationMs: 0 }
  }
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) throw invalid()
  const width = bytes.readUInt16LE(6)
  const height = bytes.readUInt16LE(8)
  if (!width || !height || width > limits.gifDimension || height > limits.gifDimension) throw new Error('El GIF debe medir como máximo 1024 × 1024 píxeles.')
  let offset = 13 + ((bytes[10] & 128) ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0)
  let frames = 0
  let durationMs = 0
  let delay = 100
  const need = (size: number) => {
    if (offset + size > bytes.length) throw invalid()
  }
  const blocks = () => {
    while (true) {
      need(1)
      const size = bytes[offset++]
      if (!size) return
      need(size)
      offset += size
    }
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) {
      if (offset !== bytes.length || frames < 2) throw new Error('El GIF debe estar completo y contener al menos dos cuadros.')
      return { width, height, frames, durationMs }
    }
    if (marker === 0x21) {
      need(1)
      if (bytes[offset++] === 0xf9) {
        need(6)
        if (bytes[offset] !== 4 || bytes[offset + 5] !== 0) throw invalid()
        const hundredths = bytes.readUInt16LE(offset + 2)
        delay = hundredths ? Math.max(20, hundredths * 10) : 100
        offset += 6
      } else blocks()
    } else if (marker === 0x2c) {
      need(9)
      const left = bytes.readUInt16LE(offset)
      const top = bytes.readUInt16LE(offset + 2)
      const frameWidth = bytes.readUInt16LE(offset + 4)
      const frameHeight = bytes.readUInt16LE(offset + 6)
      if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) throw invalid()
      const packed = bytes[offset + 8]
      offset += 9 + ((packed & 128) ? 3 * 2 ** ((packed & 7) + 1) : 0)
      need(1)
      const codeSize = bytes[offset++]
      if (codeSize < 2 || codeSize > 8) throw invalid()
      blocks()
      frames++
      durationMs += delay
      delay = 100
      if (frames > limits.gifFrames || durationMs > limits.gifDurationMs || width * height * frames * 4 > limits.decodedBytes) {
        throw new Error('El GIF es demasiado complejo. Reduzca su resolución, duración o cantidad de cuadros (máximo 30 segundos y 300 cuadros).')
      }
    } else throw invalid()
  }
  throw invalid()
}
