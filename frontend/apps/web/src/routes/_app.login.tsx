import { createFileRoute } from '@tanstack/react-router';
import { Login } from '../pages/account';
import { seo } from '../seo';

export const Route = createFileRoute('/_app/login')({
  head: () => seo('登录'),
  component: Login,
});
