import { MAX_BRANDING_LOGO_BYTES } from 'shared/branding'

// Rasterize uploads to a bounded PNG, preserving transparency and aspect ratio.
export default async function prepareBrandingLogo (file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Seleccione una imagen PNG o JPEG de hasta 5 MB.')
  }
  const source = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = source
    try {
      await image.decode()
    } catch {
      throw new Error('No se pudo leer la imagen. Seleccione un archivo PNG o JPEG válido.')
    }
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo procesar la imagen en este navegador.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const logo = canvas.toDataURL('image/png')
    if (logo.length - 'data:image/png;base64,'.length > Math.ceil(MAX_BRANDING_LOGO_BYTES / 3) * 4) {
      throw new Error('El logo procesado supera los 256 KB. Seleccione una imagen más sencilla.')
    }
    return logo
  } finally {
    URL.revokeObjectURL(source)
  }
}
