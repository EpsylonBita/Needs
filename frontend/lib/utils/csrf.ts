export async function getCsrfToken(): Promise<string> {
  try {
    const res = await fetch('/api/csrf', { 
      method: 'GET', 
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    
    if (!res.ok) {
      throw new Error(`CSRF token request failed: ${res.status}`)
    }
    
    const data = await res.json()
    return data.csrfToken as string
  } catch (error) {
    console.error('Failed to get CSRF token:', error)
    throw new Error('Failed to obtain CSRF token')
  }
}

export async function withCsrfHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  try {
    const token = await getCsrfToken()
    return { 'X-CSRF-Token': token, ...extra }
  } catch (error) {
    console.error('CSRF header preparation failed:', error)
    // Return headers without CSRF token rather than failing completely
    return { ...extra }
  }
}