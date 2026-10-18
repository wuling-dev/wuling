import { createFileRoute } from '@tanstack/react-router';
import { Workspace } from '../pages/workspace';
import { seo } from '../seo';

export const Route = createFileRoute('/_app/workspace')({
  head: () => seo('工作台'),
  component: Workspace,
});
