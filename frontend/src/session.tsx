import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api, browserAuth, type User } from './api'
import type { AuthNotice } from './auth-client'

const tabId = typeof window === 'undefined' ? '' : crypto.randomUUID()
const Session = createContext<{ user: User | null; ready: boolean; logout: () => Promise<void> }>({
  user: null, ready: false, logout: async () => {},
})
export const useSession = () => useContext(Session)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }))
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  const currentUser = useRef<User | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    const clear = (notice: AuthNotice) => {
      cache.clear()
      setUser(null)
      if (currentUser.current || notice === 'changed') {
        setLeaving(true)
        window.location.replace('/login')
      }
    }
    const unsubscribe = browserAuth?.subscribe(clear)
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('wuling-session')
      channel.current.onmessage = event => {
        if (event.data?.type === 'changed' && event.data.source !== tabId) browserAuth?.reset('changed')
      }
    }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload() }
    window.addEventListener('pageshow', restored)
    void api<User>('/auth/me', undefined, undefined, abort.signal).then(value => {
      browserAuth?.identify(value.id)
      currentUser.current = value; setUser(value)
    }).catch(() => { /* Anonymous and expired sessions render a login entry, not private data. */ })
      .finally(() => { if (!abort.signal.aborted) setReady(true) })
    return () => { abort.abort(); unsubscribe?.(); channel.current?.close(); window.removeEventListener('pageshow', restored) }
  }, [cache])
  async function logout() {
    setLeaving(true); setError(''); cache.clear()
    // Invalidate queued/in-flight responses before making the logout request.
    currentUser.current = null
    browserAuth?.reset('expired')
    try {
      await api('/auth/logout', undefined, 'POST')
      channel.current?.postMessage({ type: 'changed', source: tabId })
      window.location.replace('/login')
    } catch {
      setError('退出请求未完成，私有内容已隐藏。请检查网络后重试退出。')
    }
  }
  return <QueryClientProvider client={cache}><Session.Provider value={{ user, ready, logout }}>
    {leaving ? <section role="status"><h1>{error ? '尚未完成退出' : '正在清理会话…'}</h1>{error && <><p role="alert">{error}</p><button onClick={() => { void logout() }}>重试退出</button></>}</section>
      : <div key={user?.id ?? 'anonymous'}>{children}</div>}
  </Session.Provider></QueryClientProvider>
}
export function identityChanged() {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('wuling-session') : null
  channel?.postMessage({ type: 'changed', source: tabId }); channel?.close()
  browserAuth?.reset('expired')
  window.location.replace('/')
}
