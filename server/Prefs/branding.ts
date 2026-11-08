import { MAX_BRANDING_LOGO_BYTES, normalizeBrandingSupportUrl, validatePlayerBranding, type ClientBranding } from '../../shared/branding.js'

export function validateBranding (input: unknown): ClientBranding {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La marca del cliente no es válida.')
  }
  const { name, logoSrc, supportUrl, player } = input as Record<string, unknown>
  if (typeof name !== 'string' || name.trim().length > 100
    || typeof logoSrc !== 'string' || typeof supportUrl !== 'string') {
    throw new Error('Revise el nombre, el logo y el enlace de soporte.')
  }

  const url = normalizeBrandingSupportUrl(supportUrl)
  if (url === null) {
    throw new Error('El enlace de soporte debe ser una URL HTTPS válida.')
  }

  if (logoSrc) {
    const prefix = 'data:image/png;base64,'
    if (logoSrc.length > prefix.length + Math.ceil(MAX_BRANDING_LOGO_BYTES / 3) * 4
      || !logoSrc.startsWith(prefix)) {
      throw new Error('El logo debe ser PNG y no superar los 256 KB.')
    }
    const encoded = logoSrc.slice(prefix.length)
    const image = Buffer.from(encoded, 'base64')
    if (image.length > MAX_BRANDING_LOGO_BYTES || image.toString('base64') !== encoded
      || image.length < 45 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || image.subarray(-12).toString('hex') !== '0000000049454e44ae426082'
      || image.readUInt32BE(8) !== 13 || image.toString('ascii', 12, 16) !== 'IHDR'
      || image.readUInt32BE(16) < 1 || image.readUInt32BE(16) > 2048
      || image.readUInt32BE(20) < 1 || image.readUInt32BE(20) > 2048) {
      throw new Error('El logo PNG no es válido o supera las dimensiones permitidas (2048 × 2048).')
    }
  }

  return { name: name.trim(), logoSrc, supportUrl: url, player: validatePlayerBranding(player) }
}
