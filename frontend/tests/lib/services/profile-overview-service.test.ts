import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getProfileOverview } from '@/lib/services/profile-overview-service'

const state = vi.hoisted(() => ({
  userId: 'account-one', failureTable: '', nullCount: false, requests: [] as { table: string; filters: [string, unknown][] }[],
  rows: {} as Record<string, Record<string, unknown>[]>,
}))
vi.mock('@/lib/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: state.userId } }, error: null }) },
  from: (table: string) => {
    const request = { table, filters: [] as [string, unknown][] }
    state.requests.push(request)
    let head = false
    let limit = Infinity
    const result = () => {
      if (state.failureTable === table) return { data: null, count: null, error: { message: 'Database unavailable' } }
      const data = (state.rows[table] || []).filter(row => request.filters.every(([key, value]) => row[key] === value))
      return { data: head ? null : data.slice(0, limit), count: state.nullCount ? null : data.length, error: null }
    }
    const query = {
      select: (_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return query },
      eq: (key: string, value: unknown) => { request.filters.push([key, value]); return query },
      order: () => query, limit: (value: number) => { limit = value; return query }, abortSignal: () => query,
      maybeSingle: async () => { const response = result(); return { ...response, data: response.data?.[0] || null } },
      then: (resolve: (response: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    return query
  },
} }))

beforeEach(() => {
  state.userId = 'account-one'
  state.failureTable = ''
  state.nullCount = false
  state.requests = []
  state.rows = {
    profiles: [{ id: 'profile-one', user_id: 'account-one' }, { id: 'profile-two', user_id: 'account-two' }],
    listings: [{ id: 'one', seller_id: 'profile-one', status: 'active' }, { id: 'two', seller_id: 'profile-one', status: 'sold' }, { id: 'foreign', seller_id: 'profile-two', status: 'active' }],
    chat_participants: [{ user_id: 'profile-one' }, { user_id: 'profile-one' }, { user_id: 'profile-two' }],
    reviews: [{ seller_id: 'profile-one', rating: 4 }, { seller_id: 'profile-two', rating: 1 }],
    notifications: [{ user_id: 'profile-one', read: false }, { user_id: 'profile-one', read: true }, { user_id: 'profile-two', read: false }],
  }
})

describe('authenticated profile activity', () => {
  it('counts only the authenticated profile and separates active listings and unread notifications', async () => {
    const result = await getProfileOverview('account-one', new AbortController().signal)
    expect(result).toMatchObject({ userId: 'account-one', activeListings: 1, conversations: 2, receivedReviews: 1, unreadNotifications: 1 })
    expect(result.listings.map(row => row.id)).toEqual(['one', 'two'])
    expect(result.reviews).toHaveLength(1)
    for (const request of state.requests.filter(row => row.table !== 'profiles')) {
      expect(request.filters).toContainEqual([['chat_participants', 'notifications'].includes(request.table) ? 'user_id' : 'seller_id', 'profile-one'])
    }
  })

  it('rejects a changed account before querying another profile', async () => {
    await expect(getProfileOverview('account-two', new AbortController().signal)).rejects.toThrow('session changed')
    expect(state.requests).toEqual([])
  })

  it('does not replace database failures or absent counts with zeros', async () => {
    state.failureTable = 'notifications'
    await expect(getProfileOverview('account-one', new AbortController().signal)).rejects.toThrow('could not be loaded')
    state.failureTable = ''
    state.nullCount = true
    await expect(getProfileOverview('account-one', new AbortController().signal)).rejects.toThrow('could not be loaded')
  })

  it('rejects an aborted request and a missing profile', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(getProfileOverview('account-one', controller.signal)).rejects.toThrow()
    expect(state.requests).toEqual([])
    state.rows.profiles = []
    await expect(getProfileOverview('account-one', new AbortController().signal)).rejects.toThrow('profile could not be loaded')
  })
})
