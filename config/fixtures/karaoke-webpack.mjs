import config from '../webpack.config.js'
import process from 'node:process'

// The isolated regression exercises development/StrictMode, not hot updates
// from other work in the shared checkout while a multi-minute scenario runs.
if (process.env.NODE_ENV === 'development') config.watchOptions = { ...config.watchOptions, ignored: /.*/ }
