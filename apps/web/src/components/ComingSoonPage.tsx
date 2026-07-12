import { Link } from 'react-router-dom';

interface Props {
  title: string;
  description: string;
}

// Placeholder honesto para itens do menu que ainda não têm tela — em vez de
// 404 ou de fingir uma funcionalidade que não existe. Cada uma vira uma
// etapa própria (ver README) quando entrar no roadmap.
export default function ComingSoonPage({ title, description }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface p-16 text-center shadow-card">
      <h1 className="font-serif text-2xl font-semibold text-ink-900">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-500">{description}</p>
      <Link
        to="/catalogo"
        className="mt-6 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-700"
      >
        Ir para o Catálogo
      </Link>
    </div>
  );
}
