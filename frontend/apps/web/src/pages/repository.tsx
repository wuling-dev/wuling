import { Button } from '@heroui/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { data } from '@wuling/api-client';
import type { MemberRole } from '@wuling/api-client';
import { useAccount, useSession } from '../session';
import { Failure, Field, PageTitle, RepositoryNav } from '../components';
import { RequireAccount } from './account';
import { RepositoryOverview } from './public';
import { repositoryContent } from '../api';

export function PrivateOverview({ id }: { id: number }) {
  const { api } = useSession();
  const account = useAccount();
  const repo = useQuery({
    queryKey: ['repo', account.data?.id, id],
    enabled: !!account.data,
    queryFn: () => repositoryContent(api, id),
  });
  return (
    <RequireAccount>
      <Failure error={repo.error} />
      {repo.data ? <RepositoryOverview {...repo.data} /> : <p role="status">正在读取仓库…</p>}
    </RequireAccount>
  );
}

export function RepositoryWorkspace({ id, section }: { id: number; section: string }) {
  return (
    <>
      <RepositoryNav id={id} />
      {section === 'members' ? (
        <Members id={id} />
      ) : section === 'code' ? (
        <Code id={id} />
      ) : section === 'insight' ? (
        <Insight id={id} />
      ) : ['issues', 'merge-requests', 'pipelines', 'wiki'].includes(section) ? (
        <History id={id} kind={section} />
      ) : (
        <PageTitle title="页面不存在" description="请从仓库导航选择一个页面。" />
      )}
    </>
  );
}

function Members({ id }: { id: number }) {
  const { api } = useSession();
  const account = useAccount();
  const [notice, setNotice] = useState('');
  const members = useQuery({
    queryKey: ['members', account.data?.id, id],
    enabled: !!account.data,
    queryFn: async () =>
      data(await api.GET('/api/repos/{id}/members', { params: { path: { id } } })),
  });
  const change = useMutation({
    mutationFn: async ({ userId, role }: { userId: number; role: MemberRole | null }) => {
      if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('用户 ID 必须为正整数。');
      const params = { path: { id, user_id: userId } };
      if (role) await api.PUT('/api/repos/{id}/members/{user_id}', { params, body: { role } });
      else await api.DELETE('/api/repos/{id}/members/{user_id}', { params });
      setNotice(role ? '成员权限已保存' : '成员已移除');
      await members.refetch();
    },
  });
  return (
    <RequireAccount>
      <PageTitle
        title="仓库成员"
        description="只有维护者可以管理成员。仓库所有者不能在此移除或降权。"
      />
      <Failure error={members.error} />
      {members.data && (
        <div className="settings-grid">
          <form
            className="form surface"
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate({
                userId: Number(new FormData(event.currentTarget).get('userId')),
                role: 'reader',
              });
            }}
          >
            <h2>邀请已有账号</h2>
            <Field label="用户 ID" name="userId" type="number" />
            <p className="hint">新成员初始为只读；添加后可调整角色。</p>
            <Button type="submit" isPending={change.isPending}>
              添加成员
            </Button>
          </form>
          <section className="surface">
            <h2>访问权限</h2>
            <Failure error={change.error} />
            <p role="status">{notice}</p>
            <ul className="record-list">
              {members.data.map((member) => (
                <li key={member.user_id}>
                  <div>
                    <strong>{member.username}</strong>
                    <p>
                      {member.owner ? '所有者' : `用户 ${member.user_id}`}
                      {!member.active && '（已停用）'}
                    </p>
                  </div>
                  {member.owner ? (
                    <span>维护者</span>
                  ) : (
                    <div className="actions">
                      <select
                        aria-label={`${member.username} 的角色`}
                        value={member.role}
                        disabled={change.isPending}
                        onChange={(event) =>
                          change.mutate({
                            userId: member.user_id,
                            role: event.target.value as MemberRole,
                          })
                        }
                      >
                        <option value="reader">只读</option>
                        <option value="developer">开发者</option>
                        <option value="maintainer">维护者</option>
                      </select>
                      <Button
                        variant="danger-soft"
                        isDisabled={change.isPending}
                        onPress={() => {
                          if (confirm(`移除 ${member.username} 的仓库访问权限？`))
                            change.mutate({ userId: member.user_id, role: null });
                        }}
                      >
                        移除 {member.username}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </RequireAccount>
  );
}

function Code({ id }: { id: number }) {
  const { api } = useSession();
  const account = useAccount();
  const [selectedBranch, setSelectedBranch] = useState<string>();
  const [path, setPath] = useState('');
  const branches = useQuery({
    queryKey: ['branches', account.data?.id, id],
    enabled: account.isSuccess,
    queryFn: async () =>
      data(await api.GET('/api/repos/{id}/branches', { params: { path: { id } } })),
  });
  const branch = selectedBranch ?? branches.data?.[0];
  const tree = useQuery({
    queryKey: ['tree', account.data?.id, id, branch],
    enabled: !!branch,
    queryFn: async () =>
      data(await api.GET('/api/repos/{id}/tree', { params: { path: { id }, query: { branch } } })),
  });
  const blob = useQuery({
    queryKey: ['blob', account.data?.id, id, branch, path],
    enabled: !!branch && !!path,
    queryFn: async () =>
      data(
        await api.GET('/api/repos/{id}/blob', {
          params: { path: { id }, query: { branch, path } },
        }),
      ),
  });
  return (
    <>
      <PageTitle title="代码" description="浏览仓库中的分支与文本文件。" />
      <Failure error={account.error || branches.error || tree.error || blob.error} />
      {branches.data?.length === 0 && (
        <p className="empty">仓库还没有分支。请由管理员在服务主机通过 Git 推送首次提交。</p>
      )}
      {branch && (
        <section className="surface">
          <label className="branch-picker">
            分支
            <select
              value={branch}
              onChange={(event) => {
                setSelectedBranch(event.target.value);
                setPath('');
              }}
            >
              {branches.data?.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="code-grid">
            <nav aria-label="文件列表" className="file-list">
              {tree.data?.map((file) => (
                <button
                  type="button"
                  key={file}
                  aria-pressed={path === file}
                  onClick={() => setPath(file)}
                >
                  {file}
                </button>
              ))}
            </nav>
            <div className="file-content">
              {path ? (
                <>
                  <h2>{path}</h2>
                  {blob.isPending ? (
                    <p role="status">正在读取文件…</p>
                  ) : (
                    <pre>
                      <code>{blob.data?.content}</code>
                    </pre>
                  )}
                </>
              ) : (
                <p className="empty">选择文件以阅读内容。</p>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function History({ id, kind }: { id: number; kind: string }) {
  const { api } = useSession();
  const account = useAccount();
  const items = useQuery({
    queryKey: ['history', account.data?.id, id, kind],
    enabled: account.isSuccess,
    queryFn: async () =>
      data(await api.GET('/api/repos/{id}/{kind}', { params: { path: { id, kind } } })),
  });
  const titles: Record<string, string> = {
    issues: 'Issue',
    'merge-requests': 'Merge Request',
    pipelines: '流水线',
    wiki: 'Wiki',
  };
  return (
    <>
      <PageTitle
        title={titles[kind]}
        description="历史导入记录，目前只读。编辑、合并与真实 CI 执行尚未开放。"
      />
      <Failure error={items.error || account.error} />
      <section className="surface">
        {items.isPending && <p role="status">正在读取记录…</p>}
        {items.data?.length === 0 && <p className="empty">此仓库没有历史记录。</p>}
        <ul className="history-list">
          {items.data?.map((item) => (
            <li key={item.id}>
              <details>
                <summary>
                  <span>{item.title}</span>
                  <span className="visibility">{item.state}</span>
                </summary>
                <p className="history-body">{item.body || '无正文'}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Insight({ id }: { id: number }) {
  const { api } = useSession();
  const account = useAccount();
  const insight = useQuery({
    queryKey: ['insight', account.data?.id, id],
    enabled: account.isSuccess,
    queryFn: async () =>
      data(await api.GET('/api/repos/{id}/insight', { params: { path: { id } } })),
  });
  return (
    <>
      <PageTitle
        title="Insight"
        description="历史协作记录汇总。流水线状态不代表真实 CI 执行结果。"
      />
      <Failure error={insight.error || account.error} />
      {insight.data && (
        <dl className="surface insight-list">
          <div>
            <dt>待处理 Issue</dt>
            <dd>{insight.data.open_issues}</dd>
          </div>
          <div>
            <dt>待处理 Merge Request</dt>
            <dd>{insight.data.open_merge_requests}</dd>
          </div>
          <div>
            <dt>历史成功流水线</dt>
            <dd>{insight.data.pipelines_success}</dd>
          </div>
          <div>
            <dt>历史失败流水线</dt>
            <dd>{insight.data.pipelines_failed}</dd>
          </div>
          <div>
            <dt>Wiki 页面</dt>
            <dd>{insight.data.wiki_pages}</dd>
          </div>
        </dl>
      )}
    </>
  );
}
