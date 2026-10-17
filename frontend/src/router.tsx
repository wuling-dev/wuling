import { createRootRoute, createRoute, createRouter, HeadContent, Scripts, Outlet, Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@heroui/react'
import { Key, ArrowRightFromSquare } from '@gravity-ui/icons'
import { api, type Repo } from './api'
import { SessionProvider, useSession } from './session'
import { LoginPage, TokensPage, MembersPage } from './account'
import { seo } from './seo'
const Workspace = lazy(() => import('./workspace').then(module => ({ default: module.Workspace })))
const root = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }], links: [{ rel: 'icon', href: '/assets/favicon.svg', type: 'image/svg+xml' }, ...(import.meta.env.WULING_DEV ? [{ rel: 'stylesheet', href: '/src/style.css' }] : [])] }),
  component: () => <html lang="zh-CN" data-theme="clean"><head><HeadContent /></head><body><SessionProvider><Shell /></SessionProvider><Scripts /></body></html>,
  errorComponent: ({ error, reset }) => <section role="alert"><h1>无法加载</h1><p>{error instanceof Error ? error.message : '请求失败'}</p><Button onPress={reset}>重试</Button></section>,
  notFoundComponent: () => <section><h1>页面不存在</h1><Link to="/">返回仓库</Link></section>,
})
function Shell() {
  const { user, ready, logout } = useSession()
  return <><a className="skip" href="#main">跳至内容</a><header className="site-header"><Link to="/"><img src="/assets/wuling-logo.svg" width="36" height="36" alt="" />武陵 <small>DevOps</small></Link><span>为协作而构建</span><div className="header-actions">
    {ready && (user ? <><span>{user.username}</span><Link to="/settings/tokens"><Key aria-hidden="true" />API Token</Link><Button variant="tertiary" onPress={() => { void logout() }}><ArrowRightFromSquare aria-hidden="true" />退出</Button></> : <Link to="/login">登录</Link>)}<Settings />
  </div></header><main id="main" tabIndex={-1}><Outlet /></main><footer>武陵 DevOps · Zixiao Laboratories</footer></>
}
function Settings() {
  return <details><summary>外观</summary><div className="settings"><label>主题<select aria-label="主题" onChange={event => { document.documentElement.dataset.theme = event.target.value }}><option value="clean">清新</option><option value="zixiao-labs-brand">紫霄品牌</option></select></label><label><input type="checkbox" onChange={event => document.documentElement.classList.toggle('dark', event.target.checked)} />深色模式</label></div></details>
}
const login = createRoute({ getParentRoute: () => root, path: '/login', ssr: false, head: () => seo('登录', '/login', false), component: LoginPage })
const tokens = createRoute({ getParentRoute: () => root, path: '/settings/tokens', ssr: false, head: () => seo('API Token', '/settings/tokens', false), component: TokensPage })
const index = createRoute({ getParentRoute: () => root, path: '/', head: () => seo('探索仓库', '/'), loader: () => api<Repo[]>('/repos'), component: Repositories })
function Repositories() {
  const initial = index.useLoaderData()
  const { user, ready } = useSession()
  const query = useQuery({ queryKey: ['account', user?.id ?? 'anonymous', 'repos'],
    queryFn: ({ signal }) => api<Repo[]>('/repos', undefined, undefined, signal),
    initialData: user ? undefined : initial, enabled: ready })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const repos = query.data ?? []
  return <><section className="intro"><div><p className="eyebrow">WORKSPACE / 仓库</p><h1>让想法，成为下一次提交。</h1><p>从第一行代码到每一次交付，在武陵连接你的工作。</p></div><img src="/assets/wuling-logo.svg" alt="武陵产品标识" width="100" height="100" /></section>
    <div className="toolbar"><label>搜索仓库<input value={search} onChange={event => setSearch(event.target.value)} placeholder="按仓库名称搜索" /></label><Button variant="secondary" onPress={() => { void query.refetch() }}>刷新列表</Button></div><p role="alert">{error || query.error?.message}</p>
    {query.isPending && <p role="status">正在加载仓库…</p>}<div className="repo-grid">{repos.filter(repo => repo.name.toLowerCase().includes(search.toLowerCase())).map(repo => <article key={repo.id}><span className="badge">{repo.public ? '公开' : '私有'}</span><h2><Link to="/repos/$repoId" params={{ repoId: String(repo.id) }}>{repo.name}</Link></h2><p>{repo.description || '尚未填写仓库描述'}</p><small>Git 仓库 · #{repo.id}</small></article>)}</div>
    {!repos.length && !query.isPending && <section className="empty"><h2>从第一个仓库开始</h2><p>{user ? '创建仓库，开始团队协作。' : '登录创建仓库，或浏览此部署中的公开项目。'}</p></section>}
    {user && <details className="panel"><summary>新建仓库</summary><form onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('')
      try { await api('/repos', { name: data.get('name'), description: data.get('description'), public: data.get('public') === 'on' }); form.reset(); await query.refetch() }
      catch (error) { setError((error as Error).message) } finally { setBusy(false) }
    }}><label>名称<input name="name" required pattern={'[A-Za-z0-9_\\-]+'} maxLength={80} /></label><label>描述<textarea name="description" maxLength={2000} /></label><label><input name="public" type="checkbox" />公开仓库（默认私有）</label><Button type="submit" isDisabled={busy}>{busy ? '创建中…' : '创建仓库'}</Button></form></details>}
  </>
}
const repository = createRoute({ getParentRoute: () => root, path: '/repos/$repoId',
  loader: ({ params }) => api<Repo>(`/repos/${params.repoId}`),
  head: ({ loaderData, params }) => seo(loaderData?.name || '仓库', `/repos/${params.repoId}`, loaderData?.public === true),
  component: () => { const repo = repository.useLoaderData(); return <section><p className="eyebrow">REPOSITORY / #{repo.id}</p><h1>{repo.name}</h1><p>{repo.description}</p><p className="badge">{repo.public ? '公开仓库' : '私有仓库'}</p><div className="actions"><Link to="/repos/$repoId/$section" params={{ repoId: String(repo.id), section: 'code' }}>进入工作区 →</Link><Link to="/repos/$repoId/$section" params={{ repoId: String(repo.id), section: 'members' }}>管理成员</Link></div></section> },
})
const workspace = createRoute({ getParentRoute: () => root, path: '/repos/$repoId/$section', ssr: false,
  head: ({ params }) => seo('工作区', `/repos/${params.repoId}/${params.section}`, false),
  component: () => { const { repoId, section } = workspace.useParams(); return <Suspense fallback={<p role="status">正在加载工作区…</p>}>{section === 'members' ? <MembersPage id={repoId} /> : <Workspace key={`${repoId}/${section}`} id={repoId} section={section} />}</Suspense> },
})
export function getRouter() { return createRouter({ routeTree: root.addChildren([index, repository, workspace, login, tokens]), scrollRestoration: true }) }
declare module '@tanstack/react-router' { interface Register { router: ReturnType<typeof getRouter> } }
