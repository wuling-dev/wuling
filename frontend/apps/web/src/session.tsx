import { createContext, use, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError, data } from '@wuling/api-client';
import { browserSession } from './api';

type Runtime = ReturnType<typeof browserSession> & { cache: QueryClient };
const SessionContext = createContext<Runtime | null>(null);
let pageId: string | undefined;
const sourceId = () => (pageId ??= crypto.randomUUID());

/** Only mounted inside ssr:false routes. No session or query cache exists on the server. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => ({
    ...browserSession(),
    cache: new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: true },
        mutations: { retry: false, gcTime: 0 },
      },
    }),
  }));
  useEffect(() => {
    const channel = new BroadcastChannel('wuling-account');
    const clear = () => {
      runtime.cache.clear();
      // Full navigation also discards route data, one-time tokens and pending component state.
      location.replace('/login');
    };
    const unsubscribe = runtime.session.subscribe(() => {
      if (runtime.cache.getQueryData(['account'])) clear();
    });
    const changed = (event: MessageEvent) => {
      if (event.data?.source !== sourceId()) clear();
    };
    channel.addEventListener('message', changed);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener('pageshow', restore);
    return () => {
      unsubscribe();
      channel.removeEventListener('message', changed);
      channel.close();
      window.removeEventListener('pageshow', restore);
    };
  }, [runtime]);
  return (
    <SessionContext value={runtime}>
      <QueryClientProvider client={runtime.cache}>{children}</QueryClientProvider>
    </SessionContext>
  );
}

export function useSession() {
  const runtime = use(SessionContext);
  if (!runtime) throw new Error('SessionProvider is required');
  return runtime;
}

export function useAccount() {
  const { api, session } = useSession();
  return useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      try {
        const user = data(await api.GET('/api/auth/me'));
        session.identify(user.id);
        return user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function accountChanged(destination: string) {
  const channel = new BroadcastChannel('wuling-account');
  channel.postMessage({ source: sourceId() });
  channel.close();
  location.assign(destination);
}
