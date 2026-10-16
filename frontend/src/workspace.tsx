import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { api, type Item } from './api'

const sections = { code: '代码', issues: 'Issue', 'merge-requests': '合并请求', pipelines: '流水线', wiki: 'Wiki', insight: 'Insight' }
export function Workspace({ id, section }: { id: string; section: string }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [branch, setBranch] = useState('main')
  const [file, setFile] = useState('')
  const [content, setContent] = useState('')
  const base = `/repos/${id}`
  const supported = section in sections
  async function load() {
    setError('')
    try { setData(await api(`${base}/${section === 'code' ? `tree?branch=${encodeURIComponent(branch)}` : section}`)) }
    catch(e) { setError((e as Error).message) }
  }
  useEffect(() => { if (supported) void load() }, [id, section, branch])
  async function mutate(path: string, body: unknown, method?: string) {
    setBusy(true); setError('')
    try { await api(path, body, method); await load(); return true }
    catch(e) { setError((e as Error).message); return false }
    finally { setBusy(false) }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form)
    if (await mutate(`${base}/${section}`, Object.fromEntries(fields))) form.reset()
  }
  return <><p className="eyebrow"><Link to="/repos/$repoId" params={{ repoId: id }}>仓库 #{id}</Link> / 工作区</p><nav aria-label="仓库功能">{Object.entries(sections).map(([key, label]) => <Link key={key} to="/repos/$repoId/$section" params={{ repoId: id, section: key }} aria-current={section === key ? 'page' : undefined}>{label}</Link>)}</nav><div className="toolbar"><h1>{sections[section as keyof typeof sections] || '未知页面'}</h1><button onClick={load} disabled={busy || !supported}>刷新</button></div><p role="alert">{error}</p>{!supported ? <p>不存在此功能页面。</p> : !data && !error ? <p role="status">正在加载…</p> : section === 'code' ? <><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setBranch(String(f.get('branch'))) }}><label>分支<input name="branch" defaultValue={branch} required /></label><button>切换分支</button></form><p>新建空仓库暂无提交。管理员可在服务主机将本地 Git 仓库推送至 <code>data/repos/{id}.git</code>。此版本尚未提供 HTTP/SSH Git 传输。</p><div className="code-layout"><ul className="panel">{(data || []).map((path: string) => <li key={path}><button onClick={async () => { setFile(path); setContent('加载中…'); try { const result = await api<{content: string}>(`${base}/blob?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`); setContent(result.content) } catch(e) { setContent((e as Error).message) } }}>{path}</button></li>)}</ul><article><h2>{file || '选择文件'}</h2><pre>{content || '文件内容会显示在这里。'}</pre></article></div></> : section === 'insight' ? <div className="repo-grid">{Object.entries(data || {}).map(([key, value]) => <article key={key}><h2>{({ open_issues: '待处理 Issue', open_merge_requests: '待合并请求', pipelines_success: '成功流水线', pipelines_failed: '失败流水线', wiki_pages: 'Wiki 页面' } as Record<string,string>)[key]}</h2><strong className="metric">{String(value)}</strong></article>)}</div> : <><div className="items">{(data || []).map((item: Item) => <article key={item.id}><span className="badge">{item.state}</span><h2>#{item.id} {item.title}</h2>{item.source && <p>{item.source} → {item.target}</p>}<pre>{item.body}</pre>{section === 'wiki' && <details><summary>编辑正文</summary><form onSubmit={async e => { e.preventDefault(); const body = new FormData(e.currentTarget).get('body'); await mutate(`${base}/${section}/${item.id}`, {body}, 'PATCH') }}><label>正文<textarea name="body" defaultValue={item.body} maxLength={100000} /></label><button disabled={busy}>保存</button></form></details>}<div className="actions">{section === 'pipelines' ? (item.state === 'queued' ? ['running', 'canceled'] : item.state === 'running' ? ['success', 'failed', 'canceled'] : []).map(state => <button key={state} disabled={busy} onClick={() => mutate(`${base}/${section}/${item.id}`, {state}, 'PATCH')}>{state}</button>) : item.state !== 'merged' && <button disabled={busy} onClick={() => mutate(`${base}/${section}/${item.id}`, {state: item.state === 'open' ? 'closed' : 'open'}, 'PATCH')}>{item.state === 'open' ? '关闭' : '重新打开'}</button>}{section === 'merge-requests' && item.state === 'open' && <button disabled={busy} onClick={() => { if (confirm('确认执行 fast-forward 合并？')) void mutate(`${base}/merge-requests/${item.id}/merge`, {}) }}>合并（fast-forward）</button>}</div></article>)}</div>{data?.length === 0 && <section className="empty"><h2>这里还没有内容</h2><p>创建第一条记录，开始团队协作。</p></section>}{section === 'pipelines' && <p className="notice">当前提供持久化流水线队列与手动状态记录，尚未接入隔离 Runner；不会执行正文中的命令，状态不代表真实构建结果。</p>}<details className="panel"><summary>新建{sections[section as keyof typeof sections]}</summary><form onSubmit={create}><label>标题<input name="title" required maxLength={300} /></label><label>{section === 'pipelines' ? '运行说明（不执行）' : '正文（纯文本）'}<textarea name="body" maxLength={100000} /></label>{section === 'merge-requests' && <><label>源分支<input name="source" required /></label><label>目标分支<input name="target" defaultValue="main" required /></label></>}<button disabled={busy}>{busy ? '保存中…' : '创建'}</button></form></details></>}</>
}
