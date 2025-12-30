import { supabase } from '@/lib/supabase/client';

// Note: All endpoints should NOT include /api prefix since axios baseURL already has it
const _ENDPOINTS = {} as const;

// Types
export interface RegisterData {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    fullName?: string;
    phoneNumber?: string;
  };
}

// Utility to normalize responses to ensure token format consistency
export const normalizeAuthResponse = (user: Partial<AuthResponse['user']>): AuthResponse => ({ user } as AuthResponse);

// Auth service methods
const authService = {
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const { data: res, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { fullName: data.fullName, phoneNumber: data.phoneNumber } }
    })
    if (error) throw error
    return normalizeAuthResponse({ id: res.user?.id, email: res.user?.email })
  },

  login: async (data: LoginData): Promise<AuthResponse> => {
    const { data: res, error } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password })
    if (error) throw error
    const user = res.user
    return normalizeAuthResponse({ id: user?.id, email: user?.email })
  },

  logout: async (): Promise<void> => {
    await supabase.auth.signOut()
  },

  refreshToken: async (_refreshToken: string): Promise<{ accessToken: string, refreshToken: string }> => {
    const sess = await supabase.auth.getSession()
    const at = sess.data.session?.access_token || ''
    return { accessToken: at, refreshToken: '' }
  },

  getUserProfile: async (): Promise<AuthResponse> => {
    const u = await supabase.auth.getUser()
    if (!u.data.user) throw new Error('unauthorized')
    const uid = u.data.user.id
    const p = await supabase
      .from('profiles')
      .select('user_id,display_name,avatar_url')
      .eq('user_id', uid)
      .order('created_at', { ascending: true })
      .limit(1)
    const row = (p.data || [])[0]
    return { user: { id: uid, email: u.data.user.email!, fullName: row?.display_name || '' } }
  }
};

export default authService;
