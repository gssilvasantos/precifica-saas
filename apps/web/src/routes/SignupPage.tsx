import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';
import { extractErrorMessage } from '../lib/extract-error-message';

// Cadastro self-service — antes disso só existia via POST /auth/signup direto
// (usado para criar a conta demo e a conta de revisão), sem nenhuma tela.
// Cria tenant + usuário ADMIN em uma única chamada (ver AuthService.signup no
// backend) e já loga automaticamente, igual ao fluxo de login.
export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [tenantName, setTenantName] = useState('');
  const [tenantDocument, setTenantDocument] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit =
    tenantName.trim().length > 0 &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      await signup({
        tenantName: tenantName.trim(),
        tenantDocument: tenantDocument.trim() || undefined,
        name: name.trim(),
        email: email.trim(),
        password,
      });
      navigate('/catalogo', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, 'Não deu para criar a conta. Confira os dados e tente de novo.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 shadow-card">
        <h1 className="mb-1 font-serif text-2xl font-semibold text-ink-900">Criar conta</h1>
        <p className="mb-6 text-sm text-ink-500">Cadastre sua empresa para conectar seus canais e ver sua margem real.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
              Nome da empresa
            </label>
            <input
              type="text"
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="Minha Loja Ltda"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
              CNPJ (opcional)
            </label>
            <input
              type="text"
              value={tenantDocument}
              onChange={(e) => setTenantDocument(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">Seu nome</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="Seu nome completo"
            />
          </div>

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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
              Confirmar senha
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="Repita a senha"
            />
          </div>

          {error && <p className="text-sm text-margin-danger">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className="w-full rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Criando conta…' : 'Criar conta'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-500">
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-gold hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
