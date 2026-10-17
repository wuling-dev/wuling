export interface Repo { id: number; name: string; description: string; public: boolean }
export interface Item { id: number; repo_id: number; kind: string; title: string; body: string; state: string; source?: string; target?: string }
import { AuthClient, ApiError } from './auth-client'
export { ApiError }
export interface User { id: number; username: string; admin: boolean; active: boolean }
// No server-global user, credentials, QueryClient, or refresh promise.
export const browserAuth = typeof window === 'undefined' ? null : new AuthClient(
  window.fetch.bind(window),
  navigator.locks ? run => navigator.locks.request('wuling-web-auth', run) : undefined,
)
export async function api<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  if (browserAuth) return browserAuth.request<T>(path, body, method, signal)
  // SSR is intentionally anonymous; never forward Cookie from another request.
  const response = await fetch((process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000') + '/api' + path, {
    credentials: 'omit', cache: 'no-store', signal,
  })
  if (!response.ok) throw new ApiError(response.status, `无法读取公开内容 (${response.status})`)
  return response.json() as Promise<T>
}
