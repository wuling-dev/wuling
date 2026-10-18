import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { repositoryId } from '@wuling/api-client';
import { publicRepository } from '../api';
import { AccountNav } from '../pages/account';
import { RepositoryOverview } from '../pages/public';
import { PrivateOverview } from '../pages/repository';
import { seo } from '../seo';
import { SessionProvider } from '../session';

export const Route = createFileRoute('/repos/$id')({
  ssr: true,
  loader: ({ params }) => publicRepository(repositoryId(params.id)),
  head: ({ loaderData }) =>
    seo(loaderData?.repo.name ?? '仓库', !!loaderData, loaderData?.repo.description),
  component: PublicRepository,
});

function PublicRepository() {
  const content = Route.useLoaderData();
  const { id } = Route.useParams();
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
