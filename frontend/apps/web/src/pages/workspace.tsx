import { Button } from '@heroui/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { data } from '@wuling/api-client';
import { useAccount, useSession } from '../session';
import { Failure, Field, PageTitle } from '../components';

export function Workspace() {
  const { api } = useSession();
  const account = useAccount();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const repos = useQuery({
    queryKey: ['repos', account.data?.id ?? 'anonymous'],
    enabled: account.isSuccess,
    queryFn: async () => data(await api.GET('/api/repos')),
  });
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      await api.POST('/api/repos', {
        body: {
          name: String(form.get('name')),
          description: String(form.get('description')),
          public: form.get('public') === 'on',
        },
      });
      setCreating(false);
      await repos.refetch();
    },
  });
  const visible = repos.data?.filter((repo) =>
    `${repo.name} ${repo.description}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title="仓库工作台"
        description="从仓库开始，找到团队正在推进的工作。"
        action={
          account.data ? (
            <Button onPress={() => setCreating(!creating)}>新建仓库</Button>
          ) : (
            <a href="/login">登录后创建仓库</a>
          )
        }
      />
      {creating && (
        <form
          className="form surface create-repo"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(new FormData(event.currentTarget));
          }}
        >
          <h2>新建仓库</h2>
          <Field label="名称" name="name" />
          <label>
            描述
            <textarea name="description" maxLength={2000} />
          </label>
          <label className="check">
            <input type="checkbox" name="public" />
            公开仓库（README 与元数据可被搜索引擎索引）
          </label>
          <p className="hint">名称使用英文字母、数字、短横线或下划线，最多 80 个字符。</p>
          <Failure error={create.error} />
          <div className="actions">
            <Button type="submit" isPending={create.isPending}>
              创建仓库
            </Button>
            <Button variant="ghost" onPress={() => setCreating(false)}>
              取消
            </Button>
          </div>
        </form>
      )}
      <section className="repository-list surface">
        <label className="search-field">
          查找仓库
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="仓库名称或描述"
          />
        </label>
        <Failure error={repos.error || account.error} />
        {repos.isPending && <p role="status">正在读取仓库…</p>}
        {repos.data?.length === 0 && (
          <div className="empty">
            <h2>从第一个仓库开始</h2>
            <p>创建一个仓库，或请维护者邀请你加入团队的私有仓库。</p>
          </div>
        )}
        {repos.data && repos.data.length > 0 && visible?.length === 0 && (
          <p className="empty">没有匹配的仓库。试试其他名称。</p>
        )}
        <ul className="record-list">
          {visible?.map((repo) => (
            <li key={repo.id}>
              <div>
                <Link className="repo-name" to="/repos/$id" params={{ id: String(repo.id) }}>
                  {repo.name}
                </Link>
                <p>{repo.description || '暂无描述'}</p>
              </div>
              <span className="visibility">{repo.public ? '公开' : '私有'}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
