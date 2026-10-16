import { test, expect } from '@lightning-js/lightning'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

test('production HTTP serves assets, blocks indexing by default, and rejects missing assets', async () => {
  const child = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', WULING_INDEXABLE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const ready = await new Promise<string>((resolve, reject) => {
      let output = ''
      child.on('error', reject)
      child.on('exit', code => reject(new Error(`HTTP server exited: ${code}`)))
      child.stdout.on('data', bytes => { output += bytes; const match = output.match(/Wuling frontend ready at (http:\/\/[^\s]+)/); if (match) resolve(match[1]) })
    })
    const robots = await fetch(ready + '/robots.txt')
    await expect(await robots.text()).toContain('Disallow: /')
    await expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const logo = await fetch(ready + '/assets/wuling-logo.svg')
    await expect(logo.status).toBe(200)
    await expect(logo.headers.get('content-type')).toBe('image/svg+xml')
    await expect((await fetch(ready + '/assets/missing.js')).status).toBe(404)
    await expect((await fetch(ready + '/sitemap.xml')).status).toBe(404)
  } finally {
    const closed = once(child, 'exit')
    child.kill()
    await closed
  }
})
