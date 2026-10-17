import { describe, test, expect } from '@lightning-js/lightning'
import { tanstackStart } from '@wuling/nasti-tanstack-start'
describe('native Start adapter', () => {
  test('uses native hooks rather than upstream plugins', async () => {
    const plugin = tanstackStart()
    await expect(plugin.name).toBe('wuling:nasti-tanstack-start')
    const config: any = await plugin.config?.({}, { mode: 'development', command: 'serve' })
    await expect(config.environments.ssr.consumer).toBe('server')
    await expect(config.environments.client.consumer).toBe('client')
    await expect(config.environments.ssr.resolve.noExternal).toContain('@tanstack/*')
  })
  test('only exposes allowlisted public flags, not arbitrary deployment secrets', async () => {
    const plugin = tanstackStart()
    await plugin.config?.({}, { mode: 'production', command: 'build' })
    const transform = plugin.transform as (code: string, id: string) => string
    await expect(transform('import.meta.env.WULING_DEV', '/src/example.ts')).toBe('false')
    await expect(transform('import.meta.env.WULING_ADMIN_TOKEN', '/src/example.ts')).toBe('undefined')
    await expect(transform('process.env.TSS_ROUTER_BASEPATH', '/node_modules/example.js')).toBe('"/"')
  })
})
