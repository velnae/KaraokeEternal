import fs from 'node:fs'
/* global window */

export async function capturePlaybackTrace (page) {
  const destination = process.env.KARAOKE_DIAGNOSTIC_TRACE
  if (!destination || !page || page.isClosed()) return
  try {
    const trace = await page.evaluate(() => window.karaokePlaybackTrace?.snapshot())
    fs.writeFileSync(destination, JSON.stringify(trace ?? { schemaVersion: 1, unavailable: 'Player trace not loaded' }, null, 2), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    console.error('Playback trace capture failed:', error.message)
  }
}
