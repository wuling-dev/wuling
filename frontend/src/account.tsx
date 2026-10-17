import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Form, Input, Label, TextField, FieldError } from '@heroui/react'
import { ArrowRightToSquare, Key, Persons, TrashBin, Copy, ShieldCheck } from '@gravity-ui/icons'
import { api } from './api'
import { identityChanged, useSession } from './session'

export function LoginPage() {
  const { user, ready } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try { await api('/auth/login', { username: fields.get('username'), password: fields.get('password') }); identityChanged() }
    catch (error) { setError(`登录失败：${(error as Error).message}。请核对用户名和密码，或联系实例管理员。`); setBusy(false) }
  }
  return <div className="auth-layout"><section className="auth-story"><p className="eyebrow">WULING / 你的协作空间</p><h1>连接代码，<br />也连接彼此。</h1><p>从一个想法，到一次值得信任的交付。</p><div className="security-note"><ShieldCheck aria-hidden="true" /><span>安全 Cookie 会话<br /><small>凭据不会写入浏览器本地存储。</small></span></div></section>
    <Card className="account-card"><Card.Header><h2>登录武陵</h2><Card.Description>使用管理员为你创建的团队账号。</Card.Description></Card.Header><Card.Content>
      {user ? <><p>当前已登录为 {user.username}。</p><Link to="/">返回仓库</Link></> : <Form onSubmit={submit} aria-label="登录">
        <TextField name="username" isRequired autoComplete="username" isDisabled={busy}><Label>用户名</Label><Input maxLength={80} autoFocus /><FieldError /></TextField>
        <TextField name="password" type="password" isRequired autoComplete="current-password" isDisabled={busy}><Label>密码</Label><Input maxLength={1024} /><FieldError /></TextField>
        <p role="alert">{error}</p><Button type="submit" isDisabled={busy || !ready}><ArrowRightToSquare aria-hidden="true" />{busy ? '正在登录…' : '登录'}</Button>
      </Form>}
    </Card.Content><Card.Footer><small>暂不开放公开注册。无法登录？请联系实例管理员。</small></Card.Footer></Card>
  </div>
}
export function AccountRequired({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession()
  if (!ready) return <p role="status">正在核对会话…</p>
  if (!user) return <section className="empty"><h1>请先登录</h1><p>此页面需要你的团队账号。</p><Link to="/login">前往登录</Link></section>
  return children
}
interface Token { id: number; name: string; scope: 'read' | 'write'; expires_at: number }
export function TokensPage() { return <AccountRequired><TokenManager /></AccountRequired> }
function TokenManager() {
  const { user } = useSession()
  const cache = useQueryClient()
  const key = ['account', user!.id, 'tokens']
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<Token[]>('/auth/tokens', undefined, undefined, signal) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form)
    setBusy(true); setError(''); setSecret(''); setMessage('')
    try {
      const result = await api<Token & { token: string }>('/auth/tokens', {
        name: fields.get('name'), scope: fields.get('scope'), expires_in_days: Number(fields.get('days')),
      })
      setSecret(result.token); form.reset(); await cache.invalidateQueries({ queryKey: key })
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function revoke(token: Token) {
    if (!confirm(`撤销“${token.name}”？使用它的客户端将立即失去访问权限。`)) return
    setBusy(true); setError(''); setSecret('')
    try { await api(`/auth/tokens/${token.id}`, undefined, 'DELETE'); await cache.invalidateQueries({ queryKey: key }); setMessage('令牌已撤销。') }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <><div className="page-title"><Key aria-hidden="true" /><div><p className="eyebrow">个人设置 / 访问凭据</p><h1>API Token</h1><p>为客户端分配最小权限，随时撤销。</p></div></div>
    <div className="account-grid"><Card><Card.Header><h2>你的令牌</h2><Card.Description>权限始终受当前仓库成员角色约束。</Card.Description></Card.Header><Card.Content>
      <p role="alert">{error || query.error?.message}</p><p role="status">{message}</p>
      {secret && <section className="secret-once"><h3>仅展示这一次</h3><p>请存入凭据管理器，关闭后无法找回。不要提交到仓库。</p><code data-testid="new-token">{secret}</code><div className="actions"><Button variant="secondary" onPress={() => { void navigator.clipboard.writeText(secret).then(() => setMessage('已复制。'), () => setMessage('复制失败，请手动选择令牌。')) }}><Copy aria-hidden="true" />复制</Button><Button variant="tertiary" onPress={() => setSecret('')}>我已保存，隐藏</Button></div></section>}
      {query.isPending ? <p role="status">正在加载令牌…</p> : <ul className="account-list">{query.data?.map(token => <li key={token.id}><div><strong>{token.name}</strong><p>{token.scope === 'read' ? '只读' : '读取和开发写入'} · 到期 {new Date(token.expires_at * 1000).toLocaleDateString('zh-CN')}</p></div><Button variant="danger-soft" isDisabled={busy} onPress={() => { void revoke(token) }} aria-label={`撤销 ${token.name}`}><TrashBin aria-hidden="true" />撤销</Button></li>)}</ul>}
      {query.data?.length === 0 && <p className="empty">尚无令牌。为每个客户端单独创建，方便管理。</p>}
    </Card.Content></Card><Card><Card.Header><h2>创建令牌</h2></Card.Header><Card.Content><Form onSubmit={create} aria-label="创建令牌">
      <TextField name="name" isRequired><Label>名称</Label><Input placeholder="例如：工作电脑" maxLength={80} /><FieldError /></TextField>
      <label>权限<select name="scope" defaultValue="read"><option value="read">只读（推荐）</option><option value="write">读取和开发写入</option></select></label>
      <label>有效期（天）<input name="days" type="number" min={1} max={365} defaultValue={30} required /></label>
      <Button type="submit" isDisabled={busy || Boolean(secret)}>创建令牌</Button>
    </Form><p className="notice">Git HTTP 推拉仍在恢复中。这里的令牌当前可用于仓库读取 API。</p></Card.Content></Card></div></>
}
interface Member { user_id: number; username: string; active: boolean; role: string; owner: boolean }
export function MembersPage({ id }: { id: string }) { return <AccountRequired><MemberManager id={id} /></AccountRequired> }
function MemberManager({ id }: { id: string }) {
  const { user } = useSession()
  const cache = useQueryClient()
  const key = ['account', user!.id, 'repo', id, 'members']
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api<Member[]>(`/repos/${id}/members`, undefined, undefined, signal) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function change(target: number, role?: string) {
    if (!role && !confirm('移除此成员？对方将立即失去私有仓库访问权。')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await api(`/repos/${id}/members/${target}`, role ? { role } : undefined, role ? 'PUT' : 'DELETE')
      await cache.invalidateQueries({ queryKey: key }); setMessage(role ? '成员权限已保存。' : '成员已移除。')
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  return <><div className="page-title"><Persons aria-hidden="true" /><div><p className="eyebrow">仓库 #{id} / 权限管理</p><h1>仓库成员</h1><p>所有者不可移除；只有维护者可以管理成员。</p></div></div><p role="alert">{error || query.error?.message}</p><p role="status">{message}</p>
    {query.isPending ? <p role="status">正在加载成员…</p> : query.data && !query.error && <div className="account-grid"><Card><Card.Header><h2>协作者</h2></Card.Header><Card.Content><ul className="account-list">{query.data.map(member => <li key={member.user_id}><div><strong>{member.username}</strong><p>#{member.user_id} · {member.owner ? '所有者' : member.active ? '已启用' : '已停用'}</p></div>{member.owner ? <span className="badge">维护者</span> : <div className="actions"><select aria-label={`${member.username} 的角色`} value={member.role} disabled={busy} onChange={event => { void change(member.user_id, event.target.value) }}><option value="reader">只读</option><option value="developer">开发者</option><option value="maintainer">维护者</option></select><Button variant="danger-soft" isDisabled={busy} onPress={() => { void change(member.user_id) }} aria-label={`移除 ${member.username}`}><TrashBin aria-hidden="true" />移除</Button></div>}</li>)}</ul></Card.Content></Card>
      <Card><Card.Header><h2>添加成员</h2></Card.Header><Card.Content><Form aria-label="添加成员" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void change(Number(f.get('user')), String(f.get('role'))) }}>
        <label>用户 ID<input type="number" min={1} name="user" required /></label><label>角色<select name="role" defaultValue="reader"><option value="reader">只读</option><option value="developer">开发者</option><option value="maintainer">维护者</option></select></label><Button type="submit" isDisabled={busy}>添加成员</Button>
      </Form><p>用户 ID 由实例管理员提供。请先确认对方已有启用的账号。</p></Card.Content></Card></div>}
  </>
}
