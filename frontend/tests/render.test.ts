import { test, expect } from '@lightning-js/lightning'
import { readFile } from 'node:fs/promises'

// Run after pnpm build. Does not require a backend: SPA workspaces never load it on the server.
test('built Start handler emits SEO and an SPA shell without private workspace content', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/client/wuling-manifest.json', import.meta.url), 'utf8'))
  ;(globalThis as any).__WULING_MANIFEST__ = manifest
  const path = new URL('../dist/server/server.js', import.meta.url).href
  const { default: app } = await import(path)
  const response = await app.fetch(new Request('http://localhost:3000/repos/999/issues'))
  const html = await response.text()
  expect(response.status).toBe(200)
  expect(html).toContain('noindex,nofollow')
  expect(html).toContain('width=device-width, initial-scale=1')
  expect(html).toContain('rel="canonical"')
  expect(html).toContain('武陵')
  expect(html).not.toContain('新建Issue')
  expect(html).toContain(manifest.routes.__root__.scripts[0].attrs.src)
})
