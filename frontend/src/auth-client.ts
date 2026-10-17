/** Browser-only credential transport. Never reads Cookie values or persists tokens. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export type AuthNotice = 'expired' | 'changed'
export class AuthClient {
  private generation = 0
  private userId: number | null = null
  private listeners = new Set<(notice: AuthNotice) => void>()
  constructor(private fetcher: typeof fetch, private lock?: <T>(run: () => Promise<T>) => Promise<T>) {}
  subscribe(listener: (notice: AuthNotice) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  reset(notice: AuthNotice) {
    this.generation++
    this.userId = null
    this.listeners.forEach(listener => listener(notice))
  }
  identify(userId: number) { this.userId = userId }
  async request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
    const generation = this.generation
    const check = () => {
      signal?.throwIfAborted()
      if (generation !== this.generation) throw new DOMException('账号已变化', 'AbortError')
    }
    const run = async () => {
      check()
      const control = ['/auth/login', '/auth/logout', '/auth/refresh'].includes(path)
      let refreshed = false
      const renew = async () => {
        try {
          if (!this.lock || refreshed) throw new Error('登录已失效，请重新登录')
          refreshed = true
          const renewed = await this.fetcher('/api/auth/refresh', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
          })
          if (!renewed.ok) throw new Error('登录已失效，请重新登录')
          check()
        } catch (error) { this.reset('expired'); throw error }
      }
      // Public endpoints can return 200 with an anonymous subset when access expires.
      // Validate a known identity before accepting that response as this user's data.
      if (this.userId !== null && path !== '/auth/me' && !control) {
        let probe = await this.fetcher('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal })
        check()
        if (probe.status === 401) {
          await renew()
          probe = await this.fetcher('/api/auth/me', { credentials: 'same-origin', cache: 'no-store', signal })
          check()
        }
        if (!probe.ok) {
          if (refreshed) this.reset('expired')
          throw new ApiError(probe.status, '无法核对当前会话，请重新登录')
        } else {
          const identity = await probe.json() as { id: number }
          check()
          if (identity.id !== this.userId) {
            this.reset('changed')
            throw new DOMException('账号已变化', 'AbortError')
          }
        }
      }
      const send = () => this.fetcher('/api' + path, {
        method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', cache: 'no-store', signal,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      let response = await send()
      check()
      if (response.status === 401 && !control) {
        await renew()
        response = await send()
        check()
        if (response.status === 401) {
          this.reset('expired')
          throw new Error('登录已失效，请重新登录')
        }
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new ApiError(response.status, data.error || `请求失败 (${response.status})`)
      }
      if (response.status === 204) return undefined as T
      const data = await response.json() as T
      check()
      return data
    }
    return this.lock ? this.lock(run) : run()
  }
}
