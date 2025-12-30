import { describe, it, expect, vi } from 'vitest'
import { withCsrfHeaders } from '@/lib/utils/csrf'

describe('CSRF Utils', () => {
  it('should attach X-CSRF-Token header when CSRF fetch succeeds', async () => {
    const token = 'abc123'
    
    // Mock successful fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ csrfToken: token })
    })
    
    const headers = await withCsrfHeaders({ 'Content-Type': 'application/json' })
    
    expect(headers['X-CSRF-Token']).toBe(token)
    expect(headers['Content-Type']).toBe('application/json')
    expect(global.fetch).toHaveBeenCalledWith('/api/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    })
  })
  
  it('should return original headers when CSRF fetch fails', async () => {
    // Mock failed fetch
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    
    const headers = await withCsrfHeaders({ 'Content-Type': 'application/json' })
    
    // Should return original headers without CSRF token
    expect(headers['X-CSRF-Token']).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })
  
  it('should return original headers when CSRF response is not ok', async () => {
    // Mock failed response
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    })
    
    const headers = await withCsrfHeaders({ 'Content-Type': 'application/json' })
    
    // Should return original headers without CSRF token
    expect(headers['X-CSRF-Token']).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })
})