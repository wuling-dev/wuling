import { Outlet, createFileRoute } from '@tanstack/react-router';
import { AccountNav } from '../pages/account';
import { SessionProvider } from '../session';

export const Route = createFileRoute('/_app')({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  return (
    <SessionProvider>
      <AccountNav />
      <Outlet />
    </SessionProvider>
  );
}
