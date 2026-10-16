import type { NastiPlugin } from '@nasti-toolchain/nasti'
import { resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { loadEnvFile } from 'node:process'

/** Native adapter for explicit route trees + Rust REST APIs. No Vite plugin wrapping.
 * Server-function compilation is deliberately unsupported: use the Rust API.
 */
export function tanstackStart(): NastiPlugin {
  try { loadEnvFile('.env') } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  let root = process.cwd()
  let development = true
  const virtual = new Set(['#tanstack-router-entry', '#tanstack-start-entry', '#tanstack-start-plugin-adapters', '#tanstack-start-server-fn-resolver', 'virtual:wuling-manifest', 'tanstack-start-manifest:v'])
  return {
    name: 'wuling:nasti-tanstack-start',
    config(config, env) {
      root = resolve(config.root || process.cwd())
      const dev = env.command === 'serve'
      development = dev
      return {
        environments: {
          client: { consumer: 'client', entry: 'src/client.tsx', build: { outDir: 'dist/client' } },
          ssr: { consumer: 'server', entry: 'src/server.tsx', build: { outDir: 'dist/server' }, resolve: { noExternal: dev ? ['@tanstack/*'] : true } },
        },
      }
    },
    resolveId(id) { if (virtual.has(id)) return '\0wuling:' + id },
    load(id) {
      if (!id.startsWith('\0wuling:')) return
      const name = id.slice(8)
      if (name === '#tanstack-router-entry') return `export { getRouter } from ${JSON.stringify(resolve(root, 'src/router.tsx'))}`
      if (name === '#tanstack-start-entry') return `export { startInstance } from ${JSON.stringify(resolve(root, 'src/start.ts'))}`
      if (name === '#tanstack-start-plugin-adapters') return 'export const hasPluginAdapters = false; export const pluginSerializationAdapters = []'
      if (name === '#tanstack-start-server-fn-resolver') return 'export function getServerFnById() { throw new Error("Use the Rust REST API; server functions are not compiled by this adapter") }'
      if (name === 'tanstack-start-manifest:v' || name === 'virtual:wuling-manifest') return development
        ? 'export const tsrStartManifest = () => ({ routes: { __root__: { scripts: [{tag:"script", attrs:{type:"module",src:"/src/client.tsx"}}] } } })'
        : 'export const tsrStartManifest = () => globalThis.__WULING_MANIFEST__'
    },
    transform(code, id) {
      if (!id.includes('node_modules') && /\bcreateServerFn\s*\(/.test(code)) throw new Error('Native adapter: use Rust REST APIs instead of createServerFn')
      // Nasti does not substitute arbitrary process.env keys inside dependency modules.
      if (!/import\.meta\.env\.WULING_|process\.env\.TSS_|tanstack-start-manifest:v/.test(code)) return
      return code.replaceAll('tanstack-start-manifest:v', 'virtual:wuling-manifest')
        .replace(/import\.meta\.env\.(WULING_[A-Z_]+)/g, (_match, name) => JSON.stringify(({ WULING_DEV: development, WULING_INDEXABLE: process.env.WULING_INDEXABLE === 'true', WULING_PUBLIC_ORIGIN: process.env.WULING_PUBLIC_ORIGIN || 'http://localhost:3000' } as Record<string, unknown>)[name]) ?? 'undefined')
        .replace(/process\.env\.(TSS_[A-Z_]+)/g, (_match, name) => JSON.stringify(({ TSS_ROUTER_BASEPATH: '/', TSS_SERVER_FN_BASE: '/_server/', TSS_DEV_SERVER: String(development), TSS_DEV_SSR_STYLES_ENABLED: 'false', TSS_INLINE_CSS_ENABLED: 'false', TSS_PRERENDERING: 'false', TSS_SHELL: 'false' } as Record<string, string>)[name]) ?? 'undefined')
    },
    afterBuildApp(results, _api, context) {
      const client = results.client
      const entry = client.output.find(o => o.type === 'chunk' && o.isEntry)
      if (!entry) throw new Error('Missing client entry')
      const css = client.output.filter(o => o.fileName.endsWith('.css')).map(o => '/' + o.fileName)
      context.emitFile({ type: 'asset', fileName: 'wuling-manifest.json', source: JSON.stringify({ routes: { __root__: { scripts: [{tag: 'script', attrs: {type: 'module', src: '/' + entry.fileName}}], css } } }) })
    },
    configureServer(server) {
      // Install before the HTML fallback; do not forward the administrator token from env.
      server.middlewares.use((req: any, res: any, next: any) => {
        if (/^\/assets\/(wuling-logo|favicon(?:-16|-32)?|zixiao-labs-brand)\.svg$/.test(req.url || '')) {
          void readFile(resolve(root, '..', req.url.slice(1))).then(bytes => { res.setHeader('Content-Type', 'image/svg+xml'); res.end(bytes) }).catch(next); return
        }
        if (req.url === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); res.end('User-agent: *\nDisallow: /\n'); return }
        if (req.url?.startsWith('/api/')) {
          const target = new URL(process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000')
          const upstream = httpRequest(target, { method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, r => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res) })
          upstream.on('error', () => { res.statusCode = 502; res.end('API unavailable') }); req.pipe(upstream); return
        }
        if (!req.headers.accept?.includes('text/html')) return next()
        void (async () => {
          const mod = await server.ssrLoadModule('/src/server.tsx')
          const response = await (mod.default as { fetch: (r: Request) => Promise<Response> }).fetch(new Request(`http://localhost:3000${req.url}`))
          res.writeHead(response.status, Object.fromEntries(response.headers))
          res.end(await response.text())
        })().catch(next)
      })
    },
  }
}
