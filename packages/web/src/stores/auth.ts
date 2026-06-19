import { create } from 'zustand';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/tokenStore';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  loginWithPin: (staffId: string, pin: string, remember: boolean) => Promise<void>;
  login: (email: string) => Promise<void>;
  verify: (email: string, code: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  loginWithPin: async (staffId: string, pin: string, remember: boolean) => {
    const res = await api.post<{ user: User & { session_token?: string } }>('/auth/pin-login', { staff_id: staffId, pin, remember });
    // Auth rides on the HttpOnly first-party session cookie; the bearer token is
    // no longer persisted to storage (audit: no localStorage bearer).
    const u = res.data?.user;
    if (u) {
      const { session_token: _discard, ...userForStore } = u;
      void _discard;
      set({ user: userForStore as User });
    } else {
      set({ user: null });
    }
  },

  login: async (email: string) => {
    await api.post('/auth/login', { email });
  },

  verify: async (email: string, code: string, remember: boolean) => {
    const res = await api.post<{ user: User & { session_token?: string } }>('/auth/verify', { email, code, remember });
    // Auth rides on the HttpOnly first-party session cookie; the bearer token is
    // no longer persisted to storage (audit: no localStorage bearer).
    const u = res.data?.user;
    if (u) {
      const { session_token: _discard, ...userForStore } = u;
      void _discard;
      set({ user: userForStore as User });
    } else {
      set({ user: null });
    }
  },

  logout: async () => {
    clearToken();
    try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
    set({ user: null });
  },

  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },
}));
