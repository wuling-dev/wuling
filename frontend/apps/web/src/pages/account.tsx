import { Button } from '@heroui/react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { data } from '@wuling/api-client';
import type { TokenScope } from '@wuling/api-client';
import { accountChanged, useAccount, useSession } from '../session';
import { Failure, Field, PageTitle } from '../components';

export function Login() {
  const { api } = useSession();
  const login = useMutation({
    mutationFn: async (form: FormData) => {
      await api.POST('/api/auth/login', {
        body: {
          username: String(form.get('username')),
          password: String(form.get('password')),
        },
      });
      accountChanged('/workspace');
    },
  });
  return (
    <section className="login-layout">
      <div className="login-context">
        <img src="/assets/wuling-logo.svg" width="96" height="96" alt="" />
        <h1>
          回到你的
          <br />
          开发空间。
        </h1>
        <p>
          仓库、代码与团队上下文。
          <br />
          使用管理员分配的账号登录。
        </p>
      </div>
      <form
        className="form surface login-form"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate(new FormData(event.currentTarget));
        }}
      >
        <h2>登录武陵</h2>
        <Field label="用户名" name="username" autoComplete="username" />
        <Field label="密码" name="password" type="password" autoComplete="current-password" />
        <Failure error={login.error} />
        <Button type="submit" isPending={login.isPending}>
          {login.isPending ? '正在登录…' : '登录'}
        </Button>
        <p className="hint">无法登录？请联系实例管理员。此版本不提供公开注册。</p>
      </form>
    </section>
  );
}

export function AccountNav() {
  const account = useAccount();
  const { api } = useSession();
  const logout = useMutation({
    mutationFn: async () => {
      await api.POST('/api/auth/logout');
      accountChanged('/login');
    },
  });
  return (
    <div className="account-nav">
      {account.data ? (
        <>
          <span>{account.data.username}</span>
          <Link to="/settings/tokens">API Token</Link>
          <Button variant="ghost" isPending={logout.isPending} onPress={() => logout.mutate()}>
            退出
          </Button>
        </>
      ) : (
        <Link to="/login">登录</Link>
      )}
      <Failure error={logout.error} />
    </div>
  );
}

export function RequireAccount({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  if (account.isPending) return <p role="status">正在确认登录状态…</p>;
  if (account.error) return <Failure error={account.error} />;
  if (!account.data)
    return (
      <section className="empty">
        <h1>请先登录</h1>
        <p>此页面需要有效的登录会话。</p>
        <a href="/login">登录</a>
      </section>
    );
  return children;
}

export function Tokens() {
  const { api } = useSession();
  const account = useAccount();
  const [secret, setSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const tokens = useQuery({
    queryKey: ['tokens', account.data?.id],
    queryFn: async () => data(await api.GET('/api/auth/tokens')),
    enabled: !!account.data,
  });
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const issued = data(
        await api.POST('/api/auth/tokens', {
          body: {
            name: String(form.get('name')),
            scope: String(form.get('scope')) as TokenScope,
            expires_in_days: Number(form.get('days')),
          },
        }),
      );
      // Keep the secret out of query and mutation caches.
      setSecret(issued.token);
      await tokens.refetch();
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/auth/tokens/{id}', { params: { path: { id } } });
      setSecret(null);
      setNotice('令牌已撤销');
      await tokens.refetch();
    },
  });
  return (
    <RequireAccount>
      <PageTitle
        title="API Token"
        description="为你的工具创建凭据。原文仅显示一次，请保存在凭据管理器中。"
      />
      <div className="settings-grid">
        <form
          className="form surface"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice('');
            create.mutate(new FormData(event.currentTarget));
          }}
        >
          <h2>创建令牌</h2>
          <Field name="name" label="名称" />
          <label>
            权限
            <select name="scope">
              <option value="read">只读</option>
              <option value="write">读写（预留）</option>
            </select>
          </label>
          <Field name="days" label="有效天数" type="number" defaultValue="30" />
          <p className="hint">1–365 天。当前 HTTP API 的 Token 仅开放仓库读取。</p>
          <Failure error={create.error} />
          <Button type="submit" isPending={create.isPending}>
            创建令牌
          </Button>
        </form>
        <section className="surface">
          <h2>已创建的令牌</h2>
          {secret && (
            <div className="secret">
              <p>离开页面后无法再次查看。</p>
              <code data-testid="new-token">{secret}</code>
              <Button variant="secondary" onPress={() => setSecret(null)}>
                我已保存，隐藏
              </Button>
            </div>
          )}
          <Failure error={tokens.error || revoke.error} />
          <p role="status">{notice}</p>
          {tokens.isPending && <p role="status">正在读取令牌…</p>}
          {tokens.data?.length === 0 && (
            <p className="empty">还没有令牌。只在工具需要访问仓库时创建。</p>
          )}
          <ul className="record-list">
            {tokens.data?.map((token) => (
              <li key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <p>
                    {token.scope} / 到期 {new Date(token.expires_at * 1000).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="danger-soft"
                  isDisabled={revoke.isPending}
                  onPress={() => {
                    if (confirm(`撤销 ${token.name}？使用此令牌的工具将立即失去访问权限。`))
                      revoke.mutate(token.id);
                  }}
                >
                  撤销 {token.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </RequireAccount>
  );
}
