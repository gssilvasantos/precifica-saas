import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../features/auth/auth-context';
import { extractErrorMessage } from '../lib/extract-error-message';

// Cadastro self-service — antes disso só existia via POST /auth/signup direto
// (usado para criar a conta demo e a conta de revisão), sem nenhuma tela.
// Cria tenant + usuário ADMIN em uma única chamada (ver AuthService.signup no
// backend) e já loga automaticamente, igual ao fluxo de login.
//
// Confirmação de e-mail e mostrar/ocultar senha existem para evitar o erro
// mais comum de cadastro (digitar errado e só descobrir depois, sem como
// corrigir sozinho ainda — não existe tela de "editar minha conta" nem painel
// de administração de clientes no MVP).
export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [tenantName, setTenantName] = useState('');
  const [tenantDocument, setTenantDocument] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailsMatch = email.trim().length > 0 && email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();

  const canSubmit =
    tenantName.trim().length > 0 &&
    name.trim().length > 0 &&
    emailsMatch &&
    password.length >= 8 &&
    password === confirmPassword;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!emailsMatch) {
      setError('Os e-mails não conferem — confira se não há erro de digitação.');
      return;
    }
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
              onPaste={(e) => e.preventDefault()}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="voce@empresa.com.br"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
              Confirmar e-mail
            </label>
            <input
              type="email"
              required
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
              placeholder="Digite o e-mail de novo"
            />
            {confirmEmail.length > 0 && !emailsMatch && (
              <p className="mt-1 text-xs text-margin-danger">Os e-mails não conferem.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">Senha</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 pr-10 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
                placeholder="Mínimo 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-500 hover:text-ink-900"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
              Confirmar senha
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-ink-300 px-3 py-2 pr-10 text-sm text-ink-900 outline-none focus:border-gold focus:ring-1 focus:ring-gold"
                placeholder="Repita a senha"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-500 hover:text-ink-900"
                aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
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
