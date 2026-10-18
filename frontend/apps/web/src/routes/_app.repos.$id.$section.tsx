import { createFileRoute } from '@tanstack/react-router';
import { repositoryId } from '@wuling/api-client';
import { RepositoryWorkspace } from '../pages/repository';
import { seo } from '../seo';

export const Route = createFileRoute('/_app/repos/$id/$section')({
  head: () => seo('仓库工作区'),
  component: Section,
});

function Section() {
  const params = Route.useParams();
  return <RepositoryWorkspace id={repositoryId(params.id)} section={params.section} />;
}
