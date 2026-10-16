import { createServer, request as proxy } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname } from 'node:path'

const client = resolve('dist/client')
globalThis.__WULING_MANIFEST__ = JSON.parse(await readFile(resolve(client, 'wuling-manifest.json'), 'utf8'))
const { default: app } = await import('../dist/server/server.js')
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
const indexable = process.env.WULING_INDEXABLE === 'true'
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, process.env.WULING_PUBLIC_ORIGIN || 'http://localhost:3000')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    if (!indexable || /^\/repos\/\d+\//.test(url.pathname)) res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    if (url.pathname === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); res.end(indexable ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /repos/*/*\nSitemap: ${url.origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n'); return }
    if (url.pathname === '/sitemap.xml') {
      res.setHeader('Content-Type', 'application/xml')
      if (!indexable) { res.statusCode = 404; res.end(); return }
      // Anonymous API request: private repositories never enter the sitemap.
      const upstream = await fetch(new URL('/api/repos', process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000'))
      if (!upstream.ok) throw new Error('Sitemap API unavailable')
      const repos = await upstream.json()
      const paths = ['/', ...repos.filter(r => r.public && Number.isSafeInteger(r.id)).map(r => `/repos/${r.id}`)]
      const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
      res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${escape(new URL(path, url.origin).href)}</loc></url>`).join('')}</urlset>`); return
    }
    if (url.pathname.startsWith('/api/')) {
      const target = new URL(process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000')
      const upstream = proxy(target, { method: req.method, path: req.url, headers: {...req.headers, host: target.host} }, response => { res.writeHead(response.statusCode, {...response.headers, 'cache-control': 'no-store', 'x-robots-tag': 'noindex'}); response.pipe(res) })
      upstream.on('error', () => { res.statusCode = 502; res.end('API unavailable') }); req.pipe(upstream); return
    }
    const path = decodeURIComponent(url.pathname)
    const brand = /^\/assets\/(wuling-logo|favicon(?:-16|-32)?|zixiao-labs-brand)\.svg$/.test(path)
    const file = brand ? resolve('..', path.slice(1)) : resolve(client, '.' + path)
    if (!brand && file !== client && !file.startsWith(client + '/')) { res.statusCode = 404; res.end(); return }
    if (types[extname(file)] && await stat(file).then(s => s.isFile()).catch(() => false)) {
      res.setHeader('Content-Type', types[extname(file)]); res.end(await readFile(file)); return
    }
    if (types[extname(file)]) { res.statusCode = 404; res.end(); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
    const response = await app.fetch(new Request(url))
    res.statusCode = response.status
    response.headers.forEach((v,k) => res.setHeader(k,v))
    res.end(req.method === 'HEAD' ? undefined : await response.text())
  } catch (error) { console.error(error); res.statusCode = 500; res.end('Internal server error') }
})
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Wuling frontend ready at http://127.0.0.1:${server.address().port}`))
