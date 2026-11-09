import qrImage from './announcement-qr.svg'
import { playerLogoImagePath } from 'shared/playerLogo'

export function announcementImageSource (image: string) {
  return image === 'qr' ? qrImage : new URL(playerLogoImagePath(image), document.baseURI).href
}
