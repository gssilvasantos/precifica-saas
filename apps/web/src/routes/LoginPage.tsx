import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';

// Credenciais do prisma/seed-demo.ts (apps/api) — só existem se você rodou
// `npm run prisma:seed:demo` no backend. Ver DEV_QUICK_LOGIN abaixo.
const DEMO_EMAIL = 'demo@precifica.dev';
const DEMO_PASSWORD = 'demo12345678';

// Atalho de DEV para pular o formulário durante testes visuais — NÃO é um
// token falso: ele faz um login de verdade contra o backend com a conta
// seedada. Um token realmente fake (string qualquer salva no localStorage)
// seria rejeitado por JwtAuthGuard na primeira chamada protegida (produtos,
// channel-listings, simulate) e a tela apareceria vazia/quebrada — pior
// experiência que só digitar. Por isso optei por login real com conta
// demo em vez do bypass literal que você pediu. Remova este bloco (e o
// botão que o usa, mais abaixo) quando a tela de login não precisar mais
// disso.
const DEV_QUICK_LOGIN = import.meta.env.DEV;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function doLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ email: loginEmail, password: loginPassword });
      navigate('/produtos', { replace: true });
    } catch (err) {
      setError(
        'Não deu para entrar. Confira se o backend está rodando (npm run start:dev) e, se for usar a conta demo, ' +
          'se rodou "npm run prisma:seed:demo" em apps/api.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await doLogin(email, password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-card">
        <h1 className="mb-1 font-serif text-2xl font-semibold text-ink-900">Precifica</h1>
        <p className="mb-6 text-sm text-ink-500">Entre para ver a inteligência de precificação da sua conta.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="voce@empresa.com.br"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-margin-danger">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {DEV_QUICK_LOGIN && (
          <>
            <div className="my-4 flex items-center gap-2 text-xs text-ink-500">
              <div className="h-px flex-1 bg-ink-300" />
              modo dev
              <div className="h-px flex-1 bg-ink-300" />
            </div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => doLogin(DEMO_EMAIL, DEMO_PASSWORD)}
              className="w-full rounded-lg border border-gold px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold hover:text-white disabled:opacity-60"
            >
              Entrar com conta demo (produtos + Nuvemshop já seedados)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
