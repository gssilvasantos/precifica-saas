import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { saveAccessToken, clearAccessToken } from '../../lib/api-client';
import * as authApi from './api';
import type { AuthUser, LoginInput, SignupInput } from './api';

const USER_STORAGE_KEY = 'precifica.user';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  const applySession = (accessToken: string, sessionUser: AuthUser) => {
    saveAccessToken(accessToken);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(sessionUser));
    setUser(sessionUser);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      login: async (input) => {
        const response = await authApi.login(input);
        applySession(response.accessToken, response.user);
      },
      signup: async (input) => {
        const response = await authApi.signup(input);
        applySession(response.accessToken, response.user);
      },
      logout: () => {
        clearAccessToken();
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de <AuthProvider>.');
  return ctx;
}
