import process from 'node:process'

// Test-process-only: keep StrictMode/development output, but do not replace its
// hashed CSS while an isolated browser scenario is already in progress.
if (process.env.KARAOKE_BIRTHDAY_FIXTURE !== '1' || process.env.NODE_ENV !== 'development') throw new Error('This preload is only for the isolated birthday development fixture.')
const { default: config } = await import('./webpack.config.js')
config.watchOptions = { ...config.watchOptions, ignored: /.*/ }
