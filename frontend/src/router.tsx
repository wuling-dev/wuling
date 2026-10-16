import { createRootRoute, createRoute, createRouter, HeadContent, Scripts, Outlet, Link } from '@tanstack/react-router'
import { lazy, Suspense, useState } from 'react'
import { api, setToken, type Repo } from './api'
import { seo } from './seo'
const Workspace = lazy(() => import('./workspace').then(module => ({ default: module.Workspace })))

const root = createRootRoute({
  head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }], links: [{ rel: 'icon', href: '/assets/favicon.svg', type: 'image/svg+xml' }, ...(import.meta.env.WULING_DEV ? [{ rel: 'stylesheet', href: '/src/style.css' }] : [])] }),
  component: () => <html lang="zh-CN" data-theme="clean"><head><HeadContent /></head><body><a className="skip" href="#main">跳至内容</a><header><Link to="/"><img src="/assets/wuling-logo.svg" width="36" height="36" alt="" />武陵 <small>DevOps</small></Link><span>为协作而构建</span><Settings /></header><main id="main" tabIndex={-1}><Outlet /></main><footer>武陵 DevOps · Zixiao Laboratories</footer><Scripts /></body></html>,
  errorComponent: ({ error, reset }) => <section role="alert"><h1>无法加载</h1><p>{error instanceof Error ? error.message : '请求失败'}</p><button onClick={reset}>重试</button></section>,
  notFoundComponent: () => <section><h1>页面不存在</h1><Link to="/">返回仓库</Link></section>,
})
function Settings() {
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')
  return <details><summary>偏好与访问</summary><div className="settings"><label>访问令牌<input type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" /></label><button onClick={() => { setToken(value); setValue(''); setMessage('已应用；令牌仅存于内存，刷新后清除。请刷新列表。') }}>应用令牌</button><p role="status">{message}</p><label>主题<select onChange={e => document.documentElement.dataset.theme = e.target.value}><option value="clean">清新</option><option value="zixiao-labs-brand">紫霄品牌</option></select></label><label><input type="checkbox" onChange={e => document.documentElement.classList.toggle('dark', e.target.checked)} />深色模式</label></div></details>
}
const index = createRoute({ getParentRoute: () => root, path: '/', head: () => seo('探索仓库', '/'), loader: () => api<Repo[]>('/repos'), component: Repositories })
function Repositories() {
  const initial = index.useLoaderData()
  const [repos, setRepos] = useState(initial)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function refresh() { try { setRepos(await api('/repos')); setError('') } catch(e) { setError((e as Error).message) } }
  return <><section className="intro"><div><p className="eyebrow">WORKSPACE / 仓库</p><h1>让想法，成为下一次提交。</h1><p>从第一行代码到每一次交付，在武陵连接你的工作。</p></div><img src="/assets/wuling-logo.svg" alt="武陵产品标识" width="100" height="100" /></section><div className="toolbar"><label>搜索仓库<input value={query} onChange={e => setQuery(e.target.value)} placeholder="按仓库名称搜索" /></label><button onClick={refresh}>刷新列表</button></div><p role="alert">{error}</p><div className="repo-grid">{repos.filter(r => r.name.toLowerCase().includes(query.toLowerCase())).map(r => <article key={r.id}><span className="badge">{r.public ? '公开' : '私有'}</span><h2><Link to="/repos/$repoId" params={{ repoId: String(r.id) }}>{r.name}</Link></h2><p>{r.description || '尚未填写仓库描述'}</p><small>Git 仓库 · #{r.id}</small></article>)}</div>{!repos.length && <section className="empty"><h2>从第一个仓库开始</h2><p>使用管理员令牌创建仓库，或浏览此部署中的公开项目。</p></section>}<details className="panel"><summary>新建仓库</summary><form onSubmit={async e => { e.preventDefault(); const data = new FormData(e.currentTarget); const form = e.currentTarget; setBusy(true); try { await api('/repos', { name: data.get('name'), description: data.get('description'), public: data.get('public') === 'on' }); form.reset(); await refresh() } catch(e) { setError((e as Error).message) } finally { setBusy(false) } }}><label>名称<input name="name" required pattern="[A-Za-z0-9_-]+" maxLength={80} /></label><label>描述<textarea name="description" maxLength={2000} /></label><label><input name="public" type="checkbox" />公开仓库（默认私有）</label><button disabled={busy}>{busy ? '创建中…' : '创建仓库'}</button></form></details></>
}
const repository = createRoute({ getParentRoute: () => root, path: '/repos/$repoId', loader: ({ params }) => api<Repo>(`/repos/${params.repoId}`), head: ({ loaderData, params }) => seo(loaderData?.name || '仓库', `/repos/${params.repoId}`, loaderData?.public === true), component: () => { const repo = repository.useLoaderData(); return <section><p className="eyebrow">REPOSITORY / #{repo.id}</p><h1>{repo.name}</h1><p>{repo.description}</p><p className="badge">{repo.public ? '公开仓库' : '私有仓库'}</p><p><Link to="/repos/$repoId/$section" params={{ repoId: String(repo.id), section: 'code' }}>进入工作区 →</Link></p></section> } })
const workspace = createRoute({ getParentRoute: () => root, path: '/repos/$repoId/$section', ssr: false, head: ({ params }) => seo('工作区', `/repos/${params.repoId}/${params.section}`, false), component: () => { const { repoId, section } = workspace.useParams(); return <Suspense fallback={<p role="status">正在加载工作区…</p>}><Workspace key={`${repoId}/${section}`} id={repoId} section={section} /></Suspense> } })
export function getRouter() { return createRouter({ routeTree: root.addChildren([index, repository, workspace]), scrollRestoration: true }) }
declare module '@tanstack/react-router' { interface Register { router: ReturnType<typeof getRouter> } }
