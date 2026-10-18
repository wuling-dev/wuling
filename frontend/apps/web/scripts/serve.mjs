import { createServer, request as proxy } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const client = resolve('dist/client');
globalThis.__WULING_MANIFEST__ = JSON.parse(
  await readFile(resolve(client, 'wuling-manifest.json'), 'utf8'),
);
const { default: app } = await import('../dist/server/server.js');
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const indexable = process.env.WULING_INDEXABLE === 'true';
const origin = process.env.WULING_PUBLIC_ORIGIN || 'http://localhost:3000';
const apiOrigin = process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000';
const publicPath = (path) => path === '/' || path === '/docs' || /^\/repos\/[1-9]\d*$/.test(path);
const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (url.pathname.startsWith('/api/')) {
      const target = new URL(apiOrigin);
      const upstream = proxy(
        target,
        {
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: target.host },
        },
        (response) => {
          res.writeHead(response.statusCode, {
            ...response.headers,
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex, nofollow',
          });
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.statusCode = 502;
        res.end('API unavailable');
      });
      req.pipe(upstream);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const end = (body) => res.end(req.method === 'HEAD' ? undefined : body);
    if (url.pathname === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain');
      end(
        indexable
          ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /workspace\nDisallow: /login\nDisallow: /settings/\nDisallow: /repos/*/*\nSitemap: ${new URL('/sitemap.xml', origin).href}\n`
          : 'User-agent: *\nDisallow: /\n',
      );
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      res.setHeader('Content-Type', 'application/xml');
      if (!indexable) {
        res.statusCode = 404;
        end();
        return;
      }
      // Never forward request cookies, authorization, or a caller-controlled origin.
      const response = await fetch(new URL('/api/repos', apiOrigin), {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Sitemap API unavailable');
      const repos = await response.json();
      const paths = [
        '/',
        '/docs',
        ...repos
          .filter((repo) => repo.public && Number.isSafeInteger(repo.id) && repo.id > 0)
          .map((repo) => `/repos/${repo.id}`),
      ];
      end(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escape(new URL(path, origin).href)}</loc></url>`).join('')}</urlset>`,
      );
      return;
    }
    const path = decodeURIComponent(url.pathname);
    const brand = /^\/assets\/(wuling-logo|favicon(?:-16|-32)?|zixiao-labs-brand)\.svg$/.test(path);
    const file = brand ? resolve('../../..', path.slice(1)) : resolve(client, '.' + path);
    if (!brand && file !== client && !file.startsWith(client + '/')) {
      res.statusCode = 404;
      end();
      return;
    }
    if (types[extname(file)]) {
      if (
        await stat(file)
          .then((value) => value.isFile())
          .catch(() => false)
      ) {
        res.setHeader('Content-Type', types[extname(file)]);
        end(await readFile(file));
      } else {
        res.statusCode = 404;
        end();
      }
      return;
    }
    const response = await app.fetch(new Request(new URL(url.pathname + url.search, origin)));
    const html = await response.text();
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // The route head confirms visibility; an anonymous 404/private fallback stays noindex.
    if (indexable && publicPath(path) && response.ok && html.includes('content="index,follow"')) {
      res.setHeader('X-Robots-Tag', 'index, follow');
    }
    end(html);
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end('Internal server error');
  }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () =>
  console.log(`Wuling frontend ready at http://127.0.0.1:${server.address().port}`),
);
