import { createFileRoute } from '@tanstack/react-router';
import { Tokens } from '../pages/account';
import { seo } from '../seo';

export const Route = createFileRoute('/_app/settings/tokens')({
  head: () => seo('API Token'),
  component: Tokens,
});
