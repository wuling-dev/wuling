import Markdown from 'react-markdown';
import type { Repository } from '@wuling/api-client';
import { PageTitle, RepositoryNav } from '../components';

export function Landing() {
  return (
    <div className="landing">
      <section className="intro">
        <img
          className="product-mark"
          src="/assets/wuling-logo.svg"
          width="136"
          height="136"
          alt=""
        />
        <h1>
          代码与协作，
          <br />
          在武陵相遇。
        </h1>
        <p>
          为小团队构建的自托管开发工作台。管理仓库、阅读代码，把项目上下文留在团队自己的空间里。
        </p>
        <div className="actions">
          <a className="primary-link" href="/workspace">
            打开工作台
          </a>
          <a href="/docs">阅读系统文档</a>
        </div>
      </section>
      <section className="capabilities" aria-label="当前能力">
        <div>
          <h2>仓库是起点</h2>
          <p>创建公开或私有仓库，按成员角色控制访问，浏览分支与文件。</p>
        </div>
        <div>
          <h2>保留协作上下文</h2>
          <p>历史 Issue、Merge Request、Wiki 与流水线记录可供查阅。编辑和真实 CI 执行尚未开放。</p>
        </div>
        <div>
          <h2>接口有据可查</h2>
          <p>
            前后端共用生成的 OpenAPI 契约。<a href="/api/docs/">查看 API 参考</a>
            ，了解权限、参数与返回格式。
          </p>
        </div>
      </section>
    </div>
  );
}

export function RepositoryOverview({ repo, readme }: { repo: Repository; readme: string | null }) {
  return (
    <>
      <PageTitle
        title={repo.name}
        description={repo.description || '此仓库尚未填写描述。'}
        action={<span className="visibility">{repo.public ? '公开仓库' : '私有仓库'}</span>}
      />
      <RepositoryNav id={repo.id} />
      <section className="readme surface">
        <h2>README</h2>
        {readme ? (
          <div className="markdown">
            <Markdown skipHtml>{readme}</Markdown>
          </div>
        ) : (
          <p className="empty">仓库还没有 README。推送 README.md 后即可在此阅读项目说明。</p>
        )}
      </section>
    </>
  );
}

export function Documentation() {
  return (
    <article className="documentation markdown">
      <PageTitle title="武陵使用指南" description="当前版本的使用方式、访问边界与部署要求。" />
      <nav aria-label="文档目录">
        <a href="#repositories">仓库</a>
        <a href="#access">账号与权限</a>
        <a href="#deployment">部署</a>
        <a href="#api">API 契约</a>
      </nav>
      <h2 id="repositories">创建与浏览仓库</h2>
      <p>
        登录后进入工作台创建仓库。新仓库默认为私有，只有所有者与获邀成员可见。公开仓库的说明与
        README 可被搜索引擎收录。
      </p>
      <p>
        当前版本尚未提供 HTTP 或 SSH 推拉协议。由服务主机管理员通过本地 Git 向{' '}
        <code>data/repos/&lt;id&gt;.git</code> 推送代码，然后在代码页选择分支阅读文件。
      </p>
      <h2 id="access">账号与权限</h2>
      <p>
        账号由管理员创建，尚未开放注册。网页使用 HttpOnly Cookie 登录，不在浏览器存储中保存
        JWT。维护者可在仓库成员页分配 reader、developer 或 maintainer 角色。
      </p>
      <p>
        API Token 只在创建时显示一次。保存到你自己的凭据管理器；不要贴进 Issue
        或代码。撤销后立即失效。当前 HTTP Token 只支持仓库读取，不支持管理成员和创建令牌。
      </p>
      <h2 id="deployment">部署与搜索索引</h2>
      <p>
        此版本是单进程开发原型。对外部署前必须配置 HTTPS、访问控制、限流、持久签名密钥，以及
        PostgreSQL 和 Git 的一致备份。
      </p>
      <p>
        默认禁止搜索索引。公开部署设置 <code>WULING_INDEXABLE=true</code> 和真实的{' '}
        <code>WULING_PUBLIC_ORIGIN</code>{' '}
        后重新构建。只有首页、系统文档和公开仓库说明可索引；工作区始终为客户端 SPA。
      </p>
      <h2 id="api">统一 API 契约</h2>
      <p>
        <a href="/api/docs/">Swagger UI</a> 与 <a href="/api/openapi.json">OpenAPI JSON</a>{' '}
        由后端路由及 DTO 生成。写请求必须来自配置的网页 Origin，Cookie 由浏览器管理。
      </p>
      <p>历史协作记录暂时只读。写入与合并接口返回 503；历史流水线成功状态不代表执行过真实 CI。</p>
    </article>
  );
}
