import { create } from 'zustand';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/tokenStore';
import {
  loginWithBiometric,
  rememberIdentifier,
  type Identifier,
} from '@/lib/webauthnClient';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_acknowledged: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  loginWithPin: (identifier: Identifier, pin: string) => Promise<void>;
  loginWithWebAuthn: (identifier: Identifier) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  markPinAcknowledged: () => void;
}

function identifierBody(identifier: Identifier): Record<string, string> {
  const value = identifier.value.toUpperCase();
  if (identifier.kind === 'staff_id') return { staff_id: value };
  if (identifier.kind === 'nss_number') return { nss_number: value };
  return { intern_code: value };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  loginWithPin: async (identifier, pin) => {
    const res = await api.post<{ user: User & { session_token?: string } }>(
      '/auth/pin-login',
      { ...identifierBody(identifier), pin, remember: true },
    );
    // Auth rides on the HttpOnly first-party session cookie; the bearer token is
    // no longer persisted to storage (audit: no localStorage bearer).
    const u = res.data?.user;
    if (u) {
      const { session_token: _discard, ...userForStore } = u;
      void _discard;
      rememberIdentifier(identifier);
      set({ user: userForStore as User });
    } else {
      set({ user: null });
    }
  },
  loginWithWebAuthn: async (identifier) => {
    const u = await loginWithBiometric(identifier);
    // Auth rides on the HttpOnly first-party session cookie; the bearer token is
    // no longer persisted to storage (audit: no localStorage bearer).
    const { session_token: _discard, ...userForStore } = u;
    void _discard;
    rememberIdentifier(identifier);
    set({ user: userForStore as User });
  },
  logout: async () => {
    clearToken();
    // NOTE: last identifier is kept on device so the next biometric login knows who.
    try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
    set({ user: null });
  },
  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch { set({ user: null, isLoading: false }); }
  },
  markPinAcknowledged: () =>
    set((state) => (state.user ? { user: { ...state.user, pin_acknowledged: true } } : state)),
}));
