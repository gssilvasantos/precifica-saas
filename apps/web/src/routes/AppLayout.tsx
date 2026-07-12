import { useState, type SVGProps } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import Sidebar from '../components/Sidebar';

// Layout com sidebar persistente (desktop) / deslizante (mobile) — troca do
// header com nav horizontal usado até a etapa anterior, agora que o menu
// tem 4 seções (Dashboard, Produtos, Integrações, Configurações Fiscais).
export default function AppLayout() {
  const { user, logout } = useAuth();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen flex-1 flex-col md:pl-0">
        <header className="flex h-16 items-center justify-between border-b border-ink-300/60 bg-surface px-4 md:px-8">
          <button
            className="rounded-lg p-2 text-ink-700 hover:bg-canvas md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="font-serif text-lg font-semibold text-ink-900 md:hidden">Precifica</span>
          <div className="flex items-center gap-3 text-sm text-ink-500">
            <span>{user?.role}</span>
            <button onClick={logout} className="rounded-lg px-2 py-1 text-ink-700 hover:bg-canvas">
              Sair
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  );
}
