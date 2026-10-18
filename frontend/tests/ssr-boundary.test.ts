import { test, expect } from '@lightning-js/lightning';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

test('only landing, system docs and public README/metadata have SSR content', async () => {
  const requests: string[] = [];
  const credentials: string[] = [];
  const upstream = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.headers.cookie || req.headers.authorization) credentials.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/repos/1') {
      res.end(
        JSON.stringify({
          id: 1,
          owner_id: 1,
          name: 'public-project',
          description: 'Public repository metadata',
          public: true,
          created_at: '2026-01-01T00:00:00Z',
        }),
      );
    } else if (req.url === '/api/repos/1/branches') {
      res.end('["main"]');
    } else if (req.url?.startsWith('/api/repos/1/tree')) {
      res.end('["README.md"]');
    } else if (req.url?.startsWith('/api/repos/1/blob')) {
      res.end(
        JSON.stringify({
          content: '# Searchable README\n\nPublic readme body.\n\n<script>alert("unsafe")</script>',
        }),
      );
    } else {
      res.statusCode = 404;
      res.end('{"error":"仓库不存在"}');
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const oldOrigin = process.env.WULING_API_ORIGIN;
  process.env.WULING_API_ORIGIN = `http://127.0.0.1:${address.port}`;
  try {
    (globalThis as any).__WULING_MANIFEST__ = JSON.parse(
      await readFile(
        new URL('../apps/web/dist/client/wuling-manifest.json', import.meta.url),
        'utf8',
      ),
    );
    const { default: app } = await import(
      new URL('../apps/web/dist/server/server.js', import.meta.url).href
    );
    const render = async (path: string) => {
      const response = await app.fetch(
        new Request(`http://localhost:3000${path}`, {
          headers: {
            cookie: 'wuling_session=must-not-be-forwarded',
            authorization: 'Bearer must-not-be-forwarded',
          },
        }),
      );
      await expect(response.status).toBe(200);
      return response.text() as Promise<string>;
    };
    await expect(await render('/')).toContain('代码与协作');
    await expect(await render('/docs')).toContain('创建与浏览仓库');
    const publicHtml = await render('/repos/1');
    await expect(publicHtml).toContain('<h1>Searchable README</h1>');
    await expect(publicHtml).toContain('Public repository metadata');
    await expect(publicHtml.match(/rel="canonical"/g)?.length).toBe(1);
    await expect(publicHtml).toMatch(/rel="canonical" href="[^"]+\/repos\/1"/);
    await expect(publicHtml).not.toContain('<script>alert("unsafe")</script>');
    const privateHtml = await render('/repos/2');
    await expect(privateHtml).toContain('noindex,nofollow');
    await expect(privateHtml).not.toContain('仓库还没有 README');
    const count = requests.length;
    for (const path of [
      '/login',
      '/workspace',
      '/settings/tokens',
      '/repos/1/code',
      '/repos/1/issues',
      '/repos/2/members',
    ]) {
      const html = await render(path);
      await expect(html).toContain('noindex,nofollow');
      await expect(html).not.toContain('name="password"');
      await expect(html).not.toContain('创建令牌');
      await expect(html).not.toContain('Public readme body');
    }
    await expect(requests.length).toBe(count);
    await expect(credentials).toEqual([]);
  } finally {
    if (oldOrigin === undefined) delete process.env.WULING_API_ORIGIN;
    else process.env.WULING_API_ORIGIN = oldOrigin;
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
