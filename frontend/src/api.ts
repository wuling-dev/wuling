export interface Repo { id: number; name: string; description: string; public: boolean }
export interface Item { id: number; repo_id: number; kind: string; title: string; body: string; state: string; source?: string; target?: string }
let token = ''
export function setToken(value: string) { token = value }
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const base = import.meta.env.SSR ? (process.env.WULING_API_ORIGIN || 'http://127.0.0.1:4000') : ''
  const response = await fetch(base + '/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `请求失败 (${response.status})`) }
  return response.json()
}
