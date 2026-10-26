import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNotifications, getUnreadNotificationCount, markNotificationRead } from '@/lib/services/notification-service'

const state = vi.hoisted(() => ({
  userId: 'account-one', errorTable: '', nullCount: false,
  rows: {} as Record<string, Record<string, unknown>[]>,
  requests: [] as { table: string; filters: [string, unknown][]; order: string[]; cursor?: string; limit?: number; update?: Record<string, unknown> }[],
}))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }) },
  from: (table: string) => {
    const request: typeof state.requests[number] = { table, filters: [], order: [] }
    state.requests.push(request)
    let head = false
    const result = () => {
      if (state.errorTable === table) return { data: null, count: null, error: { message: 'Database unavailable' } }
      let data = (state.rows[table] || []).filter(row => request.filters.every(([key, value]) => row[key] === value))
      data = [...data].sort((left, right) => {
        for (const key of request.order) { const compared = String(right[key]).localeCompare(String(left[key])); if (compared) return compared }
        return 0
      })
      if (request.cursor) {
        const match = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(request.cursor)!
        data = data.filter(row => String(row.created_at) < match[1] || (row.created_at === match[2] && String(row.id) < match[3]))
      }
      if (request.update) data.forEach(row => Object.assign(row, request.update))
      return { data: head ? null : data.slice(0, request.limit ?? Infinity), count: state.nullCount ? null : data.length, error: null }
    }
    const query = {
      select: (_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return query },
      eq: (key: string, value: unknown) => { request.filters.push([key, value]); return query },
      order: (key: string) => { request.order.push(key); return query },
      limit: (limit: number) => { request.limit = limit; return query },
      or: (cursor: string) => { request.cursor = cursor; return query },
      update: (update: Record<string, unknown>) => { request.update = update; return query },
      abortSignal: () => query,
      maybeSingle: async () => { const response = result(); return { ...response, data: response.data?.[0] || null } },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  },
} }))
const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const signal = () => new AbortController().signal
beforeEach(() => {
  state.userId = 'account-one'; state.errorTable = ''; state.nullCount = false; state.requests = []
  state.rows = {
    profiles: [{ id: 'profile-one', user_id: 'account-one' }],
    notifications: Array.from({ length: 21 }, (_, index) => ({
      id: id(index), user_id: 'profile-one', type: 'payment_sent', payload: {}, read: false, created_at: '2026-10-19T12:00:00.123456+00:00',
    })),
  }
})

describe('notification persistence', () => {
  it('uses stable timestamp/id pagination scoped to the authenticated profile', async () => {
    state.rows.notifications.push({ ...state.rows.notifications[0], id: id(90), user_id: 'other-profile' })
    const first = await getNotifications('account-one', signal())
    expect(first.rows).toHaveLength(20)
    expect(first.rows[0].id).toBe(id(20))
    expect(first.nextCursor).toEqual({ createdAt: '2026-10-19T12:00:00.123456+00:00', id: id(1) })
    state.rows.notifications.push({ ...state.rows.notifications[0], id: id(30), created_at: '2026-10-19T13:00:00.000000+00:00' })
    const second = await getNotifications('account-one', signal(), first.nextCursor)
    expect(second.rows.map(row => row.id)).toEqual([id(0)])
    expect(second.nextCursor).toBeNull()
    expect(state.requests.filter(request => request.table === 'notifications').every(request => request.filters.some(([key, value]) => key === 'user_id' && value === 'profile-one'))).toBe(true)
  })
  it('does not present profile or notification failures as an empty account', async () => {
    state.errorTable = 'profiles'
    await expect(getNotifications('account-one', signal())).rejects.toThrow('profile could not be loaded')
    state.errorTable = 'notifications'
    await expect(getNotifications('account-one', signal())).rejects.toThrow('Notifications could not be loaded')
    state.errorTable = ''; state.rows.notifications = []
    expect((await getNotifications('account-one', signal())).rows).toEqual([])
  })
  it('rejects switched accounts, aborted reads and malformed cursors before reading notifications', async () => {
    await expect(getNotifications('other-account', signal())).rejects.toThrow('session changed')
    const controller = new AbortController(); controller.abort()
    await expect(getNotifications('account-one', controller.signal)).rejects.toThrow()
    await expect(getNotifications('account-one', signal(), { id: 'forged),read.eq.false', createdAt: '2026' })).rejects.toThrow()
    expect(state.requests).toEqual([])
  })
  it('only marks the current profile’s notification and checks the persisted result', async () => {
    await expect(markNotificationRead('account-one', id(0))).resolves.toMatchObject({ id: id(0), read: true })
    const request = state.requests.find(request => request.update)!
    expect(request.update).toEqual({ read: true })
    expect(request.filters).toEqual([['id', id(0)], ['user_id', 'profile-one']])
    state.rows.notifications.push({ ...state.rows.notifications[0], id: id(90), user_id: 'foreign', read: false })
    await expect(markNotificationRead('account-one', id(90))).rejects.toThrow('could not be updated')
    expect(state.rows.notifications.at(-1)?.read).toBe(false)
    state.errorTable = 'notifications'
    await expect(markNotificationRead('account-one', id(1))).rejects.toThrow('could not be updated')
  })
  it('counts unread rows exactly and never replaces failed or missing counts with zero', async () => {
    state.rows.notifications[0].read = true
    expect(await getUnreadNotificationCount('account-one', signal())).toMatchObject({ userId: 'account-one', count: 20 })
    state.nullCount = true
    await expect(getUnreadNotificationCount('account-one', signal())).rejects.toThrow('count could not be loaded')
    state.nullCount = false; state.errorTable = 'notifications'
    await expect(getUnreadNotificationCount('account-one', signal())).rejects.toThrow('count could not be loaded')
  })
})
