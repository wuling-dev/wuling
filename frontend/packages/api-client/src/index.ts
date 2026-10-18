import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths } from './schema';
export type Account = components['schemas']['Account'];
export type Repository = components['schemas']['Repository'];
export type Member = components['schemas']['Member'];
export type MemberRole = components['schemas']['MemberRole'];
export type TokenScope = components['schemas']['TokenScope'];

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

/** No global client: SSR callers and browser sessions own separate transports. */
export function createApi(
  baseUrl: string,
  transport: (request: Request) => Promise<Response> = (request) => fetch(request),
) {
  const client = createClient<paths>({ baseUrl, fetch: transport, credentials: 'same-origin' });
  client.use({
    async onResponse({ response }) {
      if (!response.ok) {
        const text = await response.clone().text();
        let message = `请求失败（${response.status}），请重试。`;
        try {
          const body: unknown = JSON.parse(text);
          if (
            body &&
            typeof body === 'object' &&
            'error' in body &&
            typeof body.error === 'string'
          ) {
            message = body.error;
          }
        } catch {
          // Do not inject raw proxy/HTML error pages into the interface.
          if (response.status === 422) message = '输入格式不正确，请检查后重试。';
        }
        throw new ApiError(response.status, message);
      }
      return response;
    },
  });
  return client;
}

export function data<T>(result: { data?: T }): T {
  if (result.data === undefined) throw new Error('接口没有返回预期的数据。');
  return result.data;
}

export function repositoryId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new Error('无效仓库 ID');
  }
  return id;
}
