import { test, expect } from '@lightning-js/lightning'
import { AuthClient } from '../src/auth-client'

function mutex() {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }
}
test('concurrent requests refresh once, retry safely, and handle 204', async () => {
  let valid = false
  let refreshes = 0
  const transport = new AuthClient(async (url, options) => {
    await expect(options?.credentials).toBe('same-origin')
    await expect(new Headers(options?.headers).has('authorization')).toBe(false)
    if (url === '/api/auth/refresh') { refreshes++; valid = true; return new Response(null, { status: 204 }) }
    return valid ? Response.json({ private: 'account-a' }) : new Response(null, { status: 401 })
  }, mutex())
  const [a, b] = await Promise.all([transport.request('/repos'), transport.request('/repos')])
  await expect(a).toEqual({ private: 'account-a' })
  await expect(b).toEqual(a)
  await expect(refreshes).toBe(1)
})
test('refresh failure clears identity, never loops, and drops late private responses', async () => {
  let calls = 0
  let expired = 0
  const failed = new AuthClient(async () => { calls++; return new Response(null, { status: 401 }) }, mutex())
  failed.subscribe(() => { expired++ })
  await expect(failed.request('/repos')).rejects.toThrow()
  await expect(calls).toBe(2)
  await expect(expired).toBe(1)
  let finish!: (response: Response) => void
  const delayed = new AuthClient(() => new Promise(resolve => { finish = resolve }))
  const request = delayed.request('/repos')
  delayed.reset('changed')
  finish(Response.json({ private: 'account-a' }))
  await expect(request).rejects.toThrow('账号已变化')
})
test('logout and login do not refresh or try to decode an empty body', async () => {
  let calls = 0
  const transport = new AuthClient(async () => { calls++; return new Response(null, { status: 204 }) }, mutex())
  await expect(await transport.request('/auth/logout', undefined, 'POST')).toBe(undefined)
  await expect(calls).toBe(1)
})
test('known identities refresh before accepting an anonymous 200 repository list', async () => {
  let valid = false
  let refreshes = 0
  const transport = new AuthClient(async url => {
    if (url === '/api/auth/me') return valid ? Response.json({ id: 1 }) : new Response(null, { status: 401 })
    if (url === '/api/auth/refresh') { valid = true; refreshes++; return new Response(null, { status: 204 }) }
    return Response.json(valid ? ['private-repo'] : [])
  }, mutex())
  transport.identify(1)
  await expect(await transport.request('/repos')).toEqual(['private-repo'])
  await expect(refreshes).toBe(1)
})
test('a changed server identity cannot populate the previous account cache', async () => {
  let notice = ''
  let reads = 0
  const transport = new AuthClient(async url => {
    if (url === '/api/auth/me') return Response.json({ id: 2 })
    reads++; return Response.json(['other-account-private'])
  }, mutex())
  transport.identify(1)
  transport.subscribe(value => { notice = value })
  await expect(transport.request('/repos')).rejects.toThrow('账号已变化')
  await expect(notice).toBe('changed')
  await expect(reads).toBe(0)
})
