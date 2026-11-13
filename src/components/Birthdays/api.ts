import HttpApi from 'lib/HttpApi'
import socket from 'lib/socket'
import type { BirthdayGrant, BirthdaySnapshot, BirthdayAsset } from 'shared/birthdays'
import type { EventScene } from 'shared/eventScenes'
import { BIRTHDAY_PLAYER } from 'shared/birthdays'

export const birthdayApi = new HttpApi('birthdays/')
export const birthdayUrl = (url: string) => new URL(url, document.baseURI).href
export async function birthdayPlayerRequest (payload: Record<string, unknown>) {
  const response: { error?: string, payload: BirthdayGrant | { id: string, assets: BirthdayAsset[], scene: EventScene | null, ambience?: BirthdayAsset | null, extraAudio?: BirthdayGrant['extraAudio'], resources?: BirthdayGrant['resources'] } | { waiting: true } | { accepted: true, remainingMs: number } | null } = await socket.timeout(10000).emitWithAck('action', { type: BIRTHDAY_PLAYER, payload })
  if (response.error) throw new Error(response.error)
  return response.payload
}
export type BirthdaySyncReply = { payload?: BirthdaySnapshot, error?: string }
