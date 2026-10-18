import {
  ClientOnly,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
} from '@tanstack/react-router';
import { repositoryId } from '@wuling/api-client';
import { Appearance, Failure } from './components';
import { publicRepository } from './api';
import { SessionProvider } from './session';
import { AccountNav, Login, Tokens } from './pages/account';
import { Documentation, Landing, RepositoryOverview } from './pages/public';
import { PrivateOverview, RepositoryWorkspace } from './pages/repository';
import { Workspace } from './pages/workspace';

function seo(
  title: string,
  publicPage = false,
  description = '武陵 DevOps，自托管代码与协作工作台。',
) {
  return {
    meta: [
      { title: `${title} · 武陵 DevOps` },
      { name: 'description', content: description },
      {
        name: 'robots',
        content:
          publicPage && import.meta.env.WULING_INDEXABLE ? 'index,follow' : 'noindex,nofollow',
      },
    ],
  };
}

function Document() {
  const { pathname } = useLocation();
  return (
    <html lang="zh-CN" data-theme="clean">
      <head>
        <HeadContent />
        <link rel="canonical" href={new URL(pathname, import.meta.env.WULING_PUBLIC_ORIGIN).href} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          跳至主要内容
        </a>
        <header className="site-header">
          <a className="brand" href="/" aria-label="武陵 DevOps">
            <img src="/assets/wuling-logo.svg" width="36" height="36" alt="" />
            <span>
              武陵 <span className="brand-detail">DevOps</span>
            </span>
          </a>
          <nav aria-label="主导航">
            <Link to="/workspace">工作台</Link>
            <Link to="/docs">系统文档</Link>
          </nav>
          <Appearance />
        </header>
        <main id="main" className="main">
          <Outlet />
        </main>
        <footer className="site-footer">
          <span>武陵 DevOps</span>
          <span>单进程开发原型</span>
          <a href="/api/docs/">API 参考</a>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}

const root = createRootRoute({
  ssr: true,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: '武陵 DevOps' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
    links: [
      { rel: 'icon', href: '/assets/favicon.svg', type: 'image/svg+xml' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap',
      },
    ],
  }),
  component: Document,
  errorComponent: ({ error }) => <Failure error={error} />,
  notFoundComponent: () => (
    <>
      <h1>页面不存在</h1>
      <a href="/">返回首页</a>
    </>
  ),
});

const landing = createRoute({
  getParentRoute: () => root,
  path: '/',
  ssr: true,
  head: () => seo('代码与协作', true),
  component: Landing,
});
const docs = createRoute({
  getParentRoute: () => root,
  path: '/docs',
  ssr: true,
  head: () => seo('使用指南', true),
  component: Documentation,
});
const repository = createRoute({
  getParentRoute: () => root,
  path: '/repos/$id',
  ssr: true,
  loader: ({ params }) => publicRepository(repositoryId(params.id)),
  head: ({ loaderData }) =>
    seo(loaderData?.repo.name ?? '仓库', !!loaderData, loaderData?.repo.description),
  component: PublicRepository,
});
function PublicRepository() {
  const content = repository.useLoaderData();
  const { id } = repository.useParams();
  return content ? (
    <RepositoryOverview {...content} />
  ) : (
    <ClientOnly fallback={<p role="status">正在打开工作区…</p>}>
      <SessionProvider>
        <AccountNav />
        <PrivateOverview id={repositoryId(id)} />
      </SessionProvider>
    </ClientOnly>
  );
}

function AppLayout() {
  return (
    <SessionProvider>
      <AccountNav />
      <Outlet />
    </SessionProvider>
  );
}
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  ssr: false,
  component: AppLayout,
});
const login = createRoute({
  getParentRoute: () => app,
  path: '/login',
  head: () => seo('登录'),
  component: Login,
});
const workspace = createRoute({
  getParentRoute: () => app,
  path: '/workspace',
  head: () => seo('工作台'),
  component: Workspace,
});
const tokens = createRoute({
  getParentRoute: () => app,
  path: '/settings/tokens',
  head: () => seo('API Token'),
  component: Tokens,
});
const section = createRoute({
  getParentRoute: () => app,
  path: '/repos/$id/$section',
  head: () => seo('仓库工作区'),
  component: Section,
});
function Section() {
  const params = section.useParams();
  return <RepositoryWorkspace id={repositoryId(params.id)} section={params.section} />;
}

export function getRouter() {
  return createRouter({
    routeTree: root.addChildren([
      landing,
      docs,
      repository,
      app.addChildren([login, workspace, tokens, section]),
    ]),
    scrollRestoration: true,
    defaultPreload: false,
    defaultPendingComponent: () => <p role="status">正在打开页面…</p>,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
