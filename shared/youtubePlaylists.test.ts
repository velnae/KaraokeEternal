import { expect, it } from 'vitest'
import { youtubePlaylistId } from './youtubePlaylists.js'

const id = 'PLfvBgYzp9y6QTdcVAL75Fw4EWw_PbZI8M'
it.each([
  `https://www.youtube.com/playlist?list=${id}&si=example`,
  ` https://m.youtube.com/watch?v=AAAAAAAAAAA&list=${id} `,
  `https://music.youtube.com/playlist?list=${id}`,
  `https://youtu.be/AAAAAAAAAAA?list=${id}`,
])('extracts a playlist from a supported shared link: %s', (url) => {
  expect(youtubePlaylistId(url)).toBe(id)
})

it.each([
  '', null, {}, 'not a link', `https://youtube.com.evil.test/playlist?list=${id}`,
  `https://user@youtube.com/playlist?list=${id}`, `https://youtube.com:8080/playlist?list=${id}`,
  `ftp://youtube.com/playlist?list=${id}`, `https://youtube.com/channel/test?list=${id}`,
  'https://youtube.com/watch?v=AAAAAAAAAAA', 'https://youtube.com/playlist?list=bad!',
])('rejects unsupported or incomplete links: %s', (url) => {
  expect(youtubePlaylistId(url)).toBeNull()
})
