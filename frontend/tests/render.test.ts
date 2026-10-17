import { test, expect } from '@lightning-js/lightning'
import { readFile } from 'node:fs/promises'

// Run after pnpm build. Does not require a backend: SPA workspaces never load it on the server.
test('built Start handler emits SEO and an SPA shell without private workspace content', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/client/wuling-manifest.json', import.meta.url), 'utf8'))
  const browserEntry = await readFile(new URL('../dist/client' + manifest.routes.__root__.scripts[0].attrs.src, import.meta.url), 'utf8')
  await expect(browserEntry).not.toContain('node:async_hooks')
  ;(globalThis as any).__WULING_MANIFEST__ = manifest
  const path = new URL('../dist/server/server.js', import.meta.url).href
  const { default: app } = await import(path)
  const response = await app.fetch(new Request('http://localhost:3000/repos/999/issues'))
  const html = await response.text()
  await expect(response.status).toBe(200)
  await expect(html).toContain('noindex,nofollow')
  await expect(html).toContain('width=device-width, initial-scale=1')
  await expect(html).toContain('rel="canonical"')
  await expect(html).toContain('武陵')
  await expect(html).not.toContain('新建Issue')
  await expect(html).toContain(manifest.routes.__root__.scripts[0].attrs.src)
})
