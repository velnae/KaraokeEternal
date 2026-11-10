process.env.KARAOKE_E2E_AUTOMATIC_CALLS = '1'
process.env.KARAOKE_E2E_NAMES_ONLY = '1'
await import('./karaoke-call-pilot.e2e.mjs')
