import { test, expect } from '@lightning-js/lightning';
import { createApi, data, repositoryId } from '@wuling/api-client';

test('typed client handles JSON errors, extractor text, and empty 204 responses', async () => {
  const api = createApi('http://localhost', async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/auth/logout') return new Response(null, { status: 204 });
    if (path === '/api/repos') return Response.json({ error: '需要有效登录会话' }, { status: 401 });
    return new Response('invalid body', { status: 422 });
  });
  await expect((await api.POST('/api/auth/logout')).response.status).toBe(204);
  await expect(api.GET('/api/repos')).rejects.toThrow('需要有效登录会话');
  await expect(
    api.POST('/api/auth/login', { body: { username: 'name', password: 'secret' } }),
  ).rejects.toThrow('输入格式不正确');
  await expect(() => data({ data: undefined })).toThrow();
  await expect(() => repositoryId('9007199254740993')).toThrow();
});

// Compile-only negative cases: removing one generated contract constraint fails typecheck.
function contractTypeChecks(api: ReturnType<typeof createApi>) {
  // @ts-expect-error Missing password.
  void api.POST('/api/auth/login', { body: { username: 'name' } });
  // @ts-expect-error Nonexistent endpoint.
  void api.GET('/api/does-not-exist');
  void api.PUT('/api/repos/{id}/members/{user_id}', {
    params: { path: { id: 1, user_id: 2 } },
    // @ts-expect-error Invalid role.
    body: { role: 'admin' },
  });
  // @ts-expect-error Missing path parameters.
  void api.GET('/api/repos/{id}');
}
void contractTypeChecks;
