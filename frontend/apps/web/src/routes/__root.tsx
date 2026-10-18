import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useLocation,
} from '@tanstack/react-router';
import { Appearance, Failure } from '../components';

export const Route = createRootRoute({
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
