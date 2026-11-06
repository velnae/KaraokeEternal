# Bridge the browser session to the upload CLI

Use the existing authenticated HTTPS browser session. Keep secrets out of tool
output; only return confirmation or file paths. Do not mint tokens or read signing
keys. This route works with the connected browser's restricted execution context.

## 1. Create a private export directory

Verify `/tmp/opencode` exists, then use `mktemp -d
/tmp/opencode/karaoke-import-XXXXXX`. Keep its mode 0700. Use the returned path
for `SESSION_FILE` below; never reuse an unfamiliar export.

## 2. Export without sandbox module imports

In `browser_run_code_unsafe`, substitute the private path and application base URL:

```javascript
async (page) => {
  const base = 'https://karaoke.puyu.pe/'
  if (new URL(page.url()).origin !== new URL(base).origin) throw new Error('Wrong origin')
  await page.context().request.storageState({ path: 'SESSION_FILE' })
  return { exported: true }
}
```

Use `page.context().request.storageState`, not a new browser context. In this
browser tool, dynamic `import()` and `require()` are unavailable and
`browser.newContext()` may be forbidden. Do not retry those approaches.
The private export can contain other context cookies; filter it immediately in
the local upload process and remove it in `finally`.

## 3. Upload and always clean up

Run this local Node block from the repository root, substituting the two file
paths. It uses the same uploader as the CLI, retaining its authentication, room,
readiness, checksum and retry checks. No cookie values appear in shell arguments.

```bash
node --import tsx --input-type=module - 'SESSION_FILE' 'RECEIPT_FILE' <<'JS'
import fs from 'node:fs/promises'
import path from 'node:path'
import { upload } from './config/media-import-api.js'

const [sessionFile, receiptFile] = process.argv.slice(2)
try {
  await fs.chmod(sessionFile, 0o600)
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'))
  const target = new URL(receipt.manifest.baseUrl)
  const state = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
  const cookies = state.cookies.filter(cookie => cookie.name === 'keToken'
    && cookie.domain.replace(/^\./, '') === target.hostname)
  if (!cookies.length) throw new Error('Application session cookie missing')
  const result = await upload(receiptFile, { storageState: { cookies, origins: [] } })
  console.log(JSON.stringify({ resourceId: result.resourceId, status: result.status,
    resource: result.resource, receiptFile }))
} finally {
  await fs.rm(sessionFile, { force: true })
  await fs.rmdir(path.dirname(sessionFile))
}
JS
```

If export fails before this block runs, remove only the private directory you
created. If cleanup fails, finish cleanup before reporting completion. Never print
the storage-state file for debugging. After upload, use the browser session for
requested activation/selection; there is no need to export credentials again.
