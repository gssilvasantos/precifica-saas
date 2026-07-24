import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'kyneti-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readInitialTheme(): Theme {
  // SSR-safe (Vite é client-only, mas mantém o guard barato). Mesma leitura
  // que o script inline em index.html já fez ANTES do React montar — aqui só
  // sincroniza o estado do React com o que já está de fato aplicado no DOM,
  // nunca decide de novo (evita um segundo "flash" se os dois discordarem).
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

// Dark é o padrão tecnológico da marca (pedido explícito do usuário) — Light
// existe como alternativa, nunca o inverso. Persistido em localStorage (app
// real do usuário, não um artifact de chat — localStorage é apropriado
// aqui), aplicado via classe `.dark` no <html> para o Tailwind (`darkMode:
// ['class']`, ver tailwind.config.js) resolver todos os tokens automaticamente.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Modo privado/quota cheia — degrada para "não persiste entre sessões",
      // nunca quebra a troca de tema em si.
    }
  }, [theme]);

  const setTheme = (next: Theme) => setThemeState(next);
  const toggleTheme = () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme precisa estar dentro de um ThemeProvider.');
  return ctx;
}
