import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import type { AppDataMode } from './api';

const APP_MODE_STORAGE_KEY = 'kyneti.appMode';

interface AppModeContextValue {
  mode: AppDataMode;
  isDemo: boolean;
  // Só o Admin pode de fato mudar de modo — ver comentário em toggleMode.
  canToggle: boolean;
  toggleMode: () => void;
  setMode: (mode: AppDataMode) => void;
}

const AppModeContext = createContext<AppModeContextValue | undefined>(undefined);

function readStoredMode(): AppDataMode {
  const raw = localStorage.getItem(APP_MODE_STORAGE_KEY);
  return raw === 'DEMO' ? 'DEMO' : 'REAL';
}

// Modo de Demonstração / Audit Mode (ver docs/audit-mode.md) — mesmo padrão
// de Context de features/auth/auth-context.tsx. `mode` decide, para toda a
// aplicação, se as telas leem dados REAIS (padrão) ou os pedidos fictícios
// do AuditSeederService — nunca os dois ao mesmo tempo, porque quem
// consome (OrderTable, Dashboard) inclui `mode` na queryKey do
// react-query, então trocar o modo força um refetch limpo, nunca uma
// mistura de cache de REAL com DEMO.
export function AppModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mode, setModeState] = useState<AppDataMode>(() => readStoredMode());

  // Admin é o único papel que pode ligar o Audit Mode (mesma exigência do
  // backend: os endpoints de /audit-mode são ADMIN-only) — se o usuário
  // logado não for Admin, força REAL e ignora qualquer valor salvo de uma
  // sessão anterior de outro usuário no mesmo navegador.
  const canToggle = user?.role === 'ADMIN';

  useEffect(() => {
    if (!canToggle && mode !== 'REAL') {
      setModeState('REAL');
      localStorage.setItem(APP_MODE_STORAGE_KEY, 'REAL');
    }
  }, [canToggle, mode]);

  const setMode = (next: AppDataMode) => {
    if (!canToggle) return;
    localStorage.setItem(APP_MODE_STORAGE_KEY, next);
    setModeState(next);
    // Recarrega os dados da tela (pedido #3 do briefing) — invalida TODA
    // query que dependa de dado real/demo em vez de forçar um reload de
    // página inteiro; queryKeys de orders/dashboard incluem `mode`, então
    // isto é suficiente para nunca mostrar dado do modo anterior.
    void queryClient.invalidateQueries();
  };

  const toggleMode = () => setMode(mode === 'REAL' ? 'DEMO' : 'REAL');

  const value = useMemo<AppModeContextValue>(
    () => ({ mode, isDemo: mode === 'DEMO', canToggle, toggleMode, setMode }),
    [mode, canToggle],
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode precisa ser usado dentro de <AppModeProvider>.');
  return ctx;
}
