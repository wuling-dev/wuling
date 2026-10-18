import type { NastiPlugin } from '@nasti-toolchain/nasti';
import { Generator, getConfig } from '@tanstack/router-generator';
import type { Config, FileEventType } from '@tanstack/router-generator';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type TanStackRouterOptions = Partial<
  Pick<
    Config,
    | 'routesDirectory'
    | 'generatedRouteTree'
    | 'routeFilePrefix'
    | 'routeFileIgnorePrefix'
    | 'routeFileIgnorePattern'
    | 'indexToken'
    | 'routeToken'
    | 'quoteStyle'
    | 'semicolons'
    | 'disableLogging'
  >
>;

/** File-route generation only; no Vite plugin or automatic code-splitting transform. */
export function tanstackRouter(options: TanStackRouterOptions = {}): NastiPlugin {
  let generator: Generator;
  let config: Config;
  let pending = Promise.resolve();
  let tree = '';

  return {
    name: 'wuling:nasti-tanstack-router',
    async configResolved(resolved) {
      config = getConfig(
        { semicolons: true, tmpDir: resolve(resolved.root, '.tanstack/tmp'), ...options },
        resolved.root,
      );
      if (config.target !== 'react' || config.virtualRouteConfig || config.autoCodeSplitting) {
        throw new Error(
          'Nasti Router adapter supports React physical file routes without autoCodeSplitting',
        );
      }
      generator = new Generator({ config, root: resolved.root });
      // App-level initialization, once before either client or SSR starts resolving imports.
      await generator.run();
      tree = await readFile(config.generatedRouteTree, 'utf8');
    },
    configureServer(server) {
      server.watcher.add(config.routesDirectory);
      const events: Record<string, FileEventType> = {
        add: 'create',
        change: 'update',
        unlink: 'delete',
      };
      server.watcher.on('all', (event: string, path: string) => {
        if (!events[event]) return;
        const file = resolve(path);
        const fromRoutes = relative(config.routesDirectory, file);
        if (
          !fromRoutes ||
          fromRoutes === '..' ||
          fromRoutes.startsWith('..' + sep) ||
          isAbsolute(fromRoutes) ||
          file === config.generatedRouteTree
        )
          return;

        // The watcher cannot await listeners. Serialize generation and recover after invalid edits.
        pending = pending
          .then(async () => {
            await generator.run({ type: events[event], path: file });
            const nextTree = await readFile(config.generatedRouteTree, 'utf8');
            if (nextTree === tree) return;
            tree = nextTree;
            // A topology change must reach SSR as well as the browser, including deleted routes.
            for (const environment of Object.values(server.environments)) {
              environment.moduleGraph.invalidateAll();
              if (environment.consumer === 'client') environment.hot.send({ type: 'full-reload' });
            }
          })
          .catch((error: unknown) => {
            const err = error instanceof Error ? error : new Error(String(error));
            server.config.logger.error(`[nasti-router] ${err.message}`, { error: err });
            server.ws.send({ type: 'error', err: { message: err.message, stack: err.stack } });
          });
      });
    },
  };
}
