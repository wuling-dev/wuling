import { createFileRoute } from '@tanstack/react-router';
import { Landing } from '../pages/public';
import { seo } from '../seo';

export const Route = createFileRoute('/')({
  ssr: true,
  head: () => seo('代码与协作', true),
  component: Landing,
});
