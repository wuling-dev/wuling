export type Lock = <T>(run: () => Promise<T>) => Promise<T>;
type Notice = 'changed' | 'expired';

/**
 * Serializes identity checks, refresh rotation and requests across tabs.
 * It never reads cookies or stores credentials. Unknown POST outcomes are not retried.
 */
export class SessionTransport {
  private generation = 0;
  private identity: number | undefined;
  private listeners = new Set<(reason: Notice) => void>();
  private readonly transport: (request: Request) => Promise<Response>;
  private readonly lock?: Lock;

  constructor(
    transport: (request: Request) => Promise<Response> = (request) => fetch(request),
    lock?: Lock,
  ) {
    this.transport = transport;
    this.lock = lock;
  }

  identify(id: number) {
    this.identity = id;
  }

  subscribe(listener: (reason: Notice) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(reason: Notice) {
    this.generation++;
    this.identity = undefined;
    for (const listener of this.listeners) listener(reason);
  }

  readonly fetch = (request: Request): Promise<Response> => {
    const generation = this.generation;
    const run = async () => {
      const assertCurrent = () => {
        if (generation !== this.generation) throw new Error('账号已变化，请重新打开页面。');
      };
      assertCurrent();
      const url = new URL(request.url);
      const authAction = ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh'].includes(
        url.pathname,
      );
      let renewed = false;
      const send = (input: Request) => {
        const headers = new Headers(input.headers);
        headers.delete('authorization');
        return this.transport(
          new Request(input, { headers, credentials: 'same-origin', cache: 'no-store' }),
        );
      };
      const renew = async () => {
        if (renewed || !this.lock) return false;
        renewed = true;
        const response = await send(
          new Request(new URL('/api/auth/refresh', url), { method: 'POST' }),
        );
        assertCurrent();
        return response.ok;
      };
      if (this.identity !== undefined && !authAction && url.pathname !== '/api/auth/me') {
        const me = new Request(new URL('/api/auth/me', url));
        let response = await send(me.clone());
        if (response.status === 401 && (await renew())) response = await send(me.clone());
        assertCurrent();
        if (!response.ok) {
          if (response.status === 401) this.reset('expired');
          return response;
        }
        const account = (await response.json()) as { id: number };
        if (account.id !== this.identity) {
          this.reset('changed');
          throw new Error('账号已变化，请重新打开页面。');
        }
      }
      let response = await send(request.clone());
      assertCurrent();
      if (response.status === 401 && !authAction && (await renew())) {
        response = await send(request.clone());
        assertCurrent();
      }
      // Fence the body too: fetch resolves at headers, before a slow private body arrives.
      const bytes = response.status === 204 ? null : await response.arrayBuffer();
      assertCurrent();
      const result = new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      if (url.pathname === '/api/auth/me' && response.ok && this.identity !== undefined) {
        const account = (await result.clone().json()) as { id: number };
        assertCurrent();
        if (account.id !== this.identity) {
          this.reset('changed');
          throw new Error('账号已变化，请重新打开页面。');
        }
      }
      if (response.status === 401 && !authAction) this.reset('expired');
      return result;
    };
    return this.lock ? this.lock(run) : run();
  };
}
