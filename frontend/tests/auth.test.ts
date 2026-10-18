import { test, expect } from '@lightning-js/lightning';
import { SessionTransport } from '@wuling/api-client/session';

const request = (path: string, method = 'GET') =>
  new Request(`http://localhost/api${path}`, { method });

function mutex() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
}
test('concurrent requests refresh once, retry safely, and handle 204', async () => {
  let valid = false;
  let refreshes = 0;
  const transport = new SessionTransport(async (input) => {
    await expect(input.credentials).toBe('same-origin');
    await expect(input.headers.has('authorization')).toBe(false);
    if (new URL(input.url).pathname === '/api/auth/refresh') {
      refreshes++;
      valid = true;
      return new Response(null, { status: 204 });
    }
    return valid ? Response.json({ private: 'account-a' }) : new Response(null, { status: 401 });
  }, mutex());
  const [a, b] = await Promise.all([
    transport.fetch(request('/repos')),
    transport.fetch(request('/repos')),
  ]);
  await expect(await a.json()).toEqual({ private: 'account-a' });
  await expect(await b.json()).toEqual({ private: 'account-a' });
  await expect(refreshes).toBe(1);
});
test('refresh failure clears identity, never loops, and drops late private responses', async () => {
  let calls = 0;
  let expired = 0;
  const failed = new SessionTransport(async () => {
    calls++;
    return new Response(null, { status: 401 });
  }, mutex());
  failed.subscribe(() => {
    expired++;
  });
  await expect((await failed.fetch(request('/repos'))).status).toBe(401);
  await expect(calls).toBe(2);
  await expect(expired).toBe(1);
  let finish!: (response: Response) => void;
  const delayed = new SessionTransport(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = delayed.fetch(request('/repos'));
  delayed.reset('changed');
  finish(Response.json({ private: 'account-a' }));
  await expect(pending).rejects.toThrow('账号已变化');
});
test('logout and login do not refresh or try to decode an empty body', async () => {
  let calls = 0;
  const transport = new SessionTransport(async () => {
    calls++;
    return new Response(null, { status: 204 });
  }, mutex());
  await expect((await transport.fetch(request('/auth/logout', 'POST'))).status).toBe(204);
  await expect(calls).toBe(1);
});
test('known identities refresh before accepting an anonymous 200 repository list', async () => {
  let valid = false;
  let refreshes = 0;
  const transport = new SessionTransport(async (input) => {
    const url = new URL(input.url).pathname;
    if (url === '/api/auth/me')
      return valid ? Response.json({ id: 1 }) : new Response(null, { status: 401 });
    if (url === '/api/auth/refresh') {
      valid = true;
      refreshes++;
      return new Response(null, { status: 204 });
    }
    return Response.json(valid ? ['private-repo'] : []);
  }, mutex());
  transport.identify(1);
  await expect(await (await transport.fetch(request('/repos'))).json()).toEqual(['private-repo']);
  await expect(refreshes).toBe(1);
});
test('a changed server identity cannot populate the previous account cache', async () => {
  let notice = '';
  let reads = 0;
  const transport = new SessionTransport(async (input) => {
    const url = new URL(input.url).pathname;
    if (url === '/api/auth/me') return Response.json({ id: 2 });
    reads++;
    return Response.json(['other-account-private']);
  }, mutex());
  transport.identify(1);
  transport.subscribe((value) => {
    notice = value;
  });
  await expect(transport.fetch(request('/repos'))).rejects.toThrow('账号已变化');
  await expect(notice).toBe('changed');
  await expect(reads).toBe(0);
});

test('without cross-tab locking, renewal fails closed; network failures never retry writes', async () => {
  let calls = 0;
  const unsupported = new SessionTransport(async () => {
    calls++;
    return new Response(null, { status: 401 });
  });
  await expect((await unsupported.fetch(request('/repos'))).status).toBe(401);
  await expect(calls).toBe(1);
  const offline = new SessionTransport(async () => {
    throw new Error('offline');
  }, mutex());
  await expect(offline.fetch(request('/repos', 'POST'))).rejects.toThrow('offline');
});

test('identity probes and slow response bodies cannot repopulate another account', async () => {
  const changed = new SessionTransport(async () => Response.json({ id: 2 }), mutex());
  changed.identify(1);
  await expect(changed.fetch(request('/auth/me'))).rejects.toThrow('账号已变化');

  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      finish = () => {
        controller.enqueue(new TextEncoder().encode('private'));
        controller.close();
      };
    },
  });
  const delayed = new SessionTransport(async () => new Response(body));
  const pending = delayed.fetch(request('/repos'));
  await Promise.resolve();
  delayed.reset('changed');
  finish();
  await expect(pending).rejects.toThrow('账号已变化');
});
