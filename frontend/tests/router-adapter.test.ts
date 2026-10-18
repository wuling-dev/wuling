import { describe, test, expect } from '@lightning-js/lightning';
import { createServer, resolveConfig } from '@nasti-toolchain/nasti';
import type { DevServer, HmrPayload, NastiPlugin } from '@nasti-toolchain/nasti';
import { tanstackRouter } from '@wuling/nasti-tanstack-router';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

async function fixture(directory = 'src/routes') {
  // Keep fixtures in the workspace, beneath web's dependencies for real SSR module resolution.
  const cache = fileURLToPath(new URL('../apps/web/.cache', import.meta.url));
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(join(cache, 'router-'));
  const routes = join(root, directory);
  await mkdir(routes, { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(
    join(routes, '__root.tsx'),
    `import { createRootRoute } from '@tanstack/react-router';
export const Route = createRootRoute({});`,
  );
  return { root, routes };
}

function route(path = '/incorrect', label = 'initial') {
  return `import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('${path}')({ staticData: { label: '${label}' } });`;
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for route generation');
    await setTimeout(25);
  }
}

describe('native Router file routes', () => {
  test('generates before build resolution with configured paths and official conventions', async () => {
    const { root, routes } = await fixture('file-routes');
    try {
      await writeFile(
        join(root, 'tsr.config.json'),
        JSON.stringify({ routesDirectory: './file-routes', generatedRouteTree: './generated.ts' }),
      );
      await mkdir(join(routes, 'posts'), { recursive: true });
      await writeFile(join(routes, 'index.tsx'), route());
      await writeFile(join(routes, '_auth.tsx'), route());
      await writeFile(join(routes, '_auth.account.tsx'), route());
      await writeFile(join(routes, 'posts/route.tsx'), route());
      await writeFile(join(routes, 'posts/$id.tsx'), route());
      await writeFile(join(routes, 'posts_.$id.edit.tsx'), route());
      await writeFile(join(routes, '-helper.tsx'), 'export const ignored = true;');
      await resolveConfig(
        { root, framework: 'react', plugins: [tanstackRouter({ disableLogging: true })] },
        'build',
      );
      const tree = await readFile(join(root, 'generated.ts'), 'utf8');
      for (const path of ['/', '/_auth/account', '/posts/$id', '/posts_/$id/edit'])
        await expect(tree).toContain(`'${path}'`);
      await expect(tree).toContain('getParentRoute: () => AuthRoute');
      await expect(tree).toContain('getParentRoute: () => PostsRoute');
      await expect(tree).not.toContain('-helper');
      await expect(await readFile(join(routes, 'posts/$id.tsx'), 'utf8')).toContain(
        "createFileRoute('/posts/$id')",
      );
      // Inline settings override tsr.config.json, and each resolution has its own generator.
      await resolveConfig(
        {
          root,
          framework: 'react',
          plugins: [tanstackRouter({ generatedRouteTree: './inline.ts', disableLogging: true })],
        },
        'build',
      );
      await expect(await readFile(join(root, 'inline.ts'), 'utf8')).toBe(tree);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails initialization for missing root routes and unsupported splitting', async () => {
    const { root, routes } = await fixture();
    try {
      await rm(join(routes, '__root.tsx'));
      let message = '';
      try {
        await resolveConfig({ root, plugins: [tanstackRouter()] }, 'build');
      } catch (error) {
        message = String(error);
      }
      await expect(message).toContain('__root');
      await writeFile(join(root, 'tsr.config.json'), '{"autoCodeSplitting":true}');
      message = '';
      try {
        await resolveConfig({ root, plugins: [tanstackRouter()] }, 'build');
      } catch (error) {
        message = String(error);
      }
      await expect(message).toContain('without autoCodeSplitting');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('real dev watcher regenerates additions, edits, renames and deletions for client and SSR', async () => {
    const { root, routes } = await fixture();
    let server: DevServer | undefined;
    const messages: HmrPayload[] = [];
    const probe: NastiPlugin = {
      name: 'test:observe-client-updates',
      configureServer(dev) {
        const client = dev.environments.client;
        const send = client.hot.send.bind(client.hot);
        client.hot.send = (payload) => {
          messages.push(payload);
          send(payload);
        };
        const sendWs = dev.ws.send.bind(dev.ws);
        dev.ws.send = (payload) => {
          if (payload.type === 'error') messages.push(payload);
          sendWs(payload);
        };
      },
    };
    try {
      await writeFile(join(routes, 'index.tsx'), route('/'));
      await writeFile(
        join(root, 'entry.ts'),
        `import { routeTree } from './src/routeTree.gen';
const children = Object.values(routeTree.children);
export const paths = children.map(route => route.options.path);
export const labels = children.map(route => route.options.staticData?.label);`,
      );
      server = await createServer({
        root,
        framework: 'react',
        logLevel: 'silent',
        plugins: [tanstackRouter({ disableLogging: true }), probe],
      });
      const dev = server;
      const reloads = () => messages.filter((message) => message.type === 'full-reload').length;
      const snapshot = () => dev.ssrLoadModule('/entry.ts');
      const initial = await snapshot();
      await expect(initial.paths).toEqual(['/']);
      // Warm both environment graphs before changing topology.
      await dev.transformRequest('/entry.ts');
      await writeFile(join(routes, 'added.tsx'), route());
      await until(() => reloads() > 0);
      await expect((await snapshot()).paths).toContain('/added');
      const transformed = await dev.transformRequest('/src/routeTree.gen.ts');
      await expect(typeof transformed === 'string' ? transformed : transformed?.code).toContain(
        '/added',
      );
      await writeFile(join(routes, 'added.tsx'), route('/added', 'edited'));
      await until(async () => ((await snapshot()).labels as string[]).includes('edited'));
      const beforeRename = reloads();
      await rename(join(routes, 'added.tsx'), join(routes, 'renamed.tsx'));
      await until(async () => {
        if (reloads() <= beforeRename) return false;
        const paths = (await snapshot()).paths as string[];
        return paths.includes('/renamed') && !paths.includes('/added');
      });
      const beforeDelete = reloads();
      await rm(join(routes, 'renamed.tsx'));
      await until(() => reloads() > beforeDelete);
      await expect((await snapshot()).paths).toEqual(['/']);
      // A generation error reaches the browser; correcting it must not poison the queue.
      await writeFile(join(routes, 'index.lazy.tsx'), 'export const Route = !!!;');
      await until(() => messages.some((message) => message.type === 'error'));
      const beforeRecovery = reloads();
      await rm(join(routes, 'index.lazy.tsx'));
      await writeFile(join(routes, 'recovered.tsx'), route());
      await until(() => reloads() > beforeRecovery);
      await expect((await snapshot()).paths).toContain('/recovered');
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
});
