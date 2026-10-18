import { createApi, data, ApiError } from '@wuling/api-client';
import { SessionTransport } from '@wuling/api-client/session';

export function browserSession() {
  const session = new SessionTransport(
    (request) => fetch(request),
    navigator.locks ? (run) => navigator.locks.request('wuling-session', run) : undefined,
  );
  const api = createApi(location.origin, session.fetch);
  return { session, api };
}

/** Anonymous by construction, including during client-side navigation of public pages. */
export function publicApi() {
  const origin =
    typeof window === 'undefined'
      ? process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000'
      : location.origin;
  return createApi(origin, (request) =>
    fetch(
      new Request(request, {
        credentials: 'omit',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      }),
    ),
  );
}

export async function repositoryContent(
  api: ReturnType<typeof createApi>,
  id: number,
  publicOnly = false,
) {
  const repo = data(await api.GET('/api/repos/{id}', { params: { path: { id } } }));
  if (publicOnly && !repo.public) return null;
  const branches = data(await api.GET('/api/repos/{id}/branches', { params: { path: { id } } }));
  const branch = branches.includes('main') ? 'main' : branches[0];
  if (!branch) return { repo, readme: null };
  const files = data(
    await api.GET('/api/repos/{id}/tree', { params: { path: { id }, query: { branch } } }),
  );
  const path = files.find((file) => /^readme(?:\.md|\.markdown|\.txt)?$/i.test(file));
  const readme = path
    ? data(
        await api.GET('/api/repos/{id}/blob', {
          params: { path: { id }, query: { branch, path } },
        }),
      ).content
    : null;
  return { repo, readme };
}

export async function publicRepository(id: number) {
  try {
    return await repositoryContent(publicApi(), id, true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
