import { createFileRoute } from '@tanstack/react-router';
import { Documentation } from '../pages/public';
import { seo } from '../seo';

export const Route = createFileRoute('/docs')({
  ssr: true,
  head: () => seo('使用指南', true),
  component: Documentation,
});
