import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode via classe `.dark` na tag <html> (ver src/features/theme/theme-context.tsx)
  // — Light é o padrão da marca a partir da Reestruturação Visual WowDash
  // (pedido explícito do usuário, 13/10/2026): o painel precisa se parecer
  // com um admin dashboard SaaS moderno "estilo WowDash" (Tailwind + shadcn,
  // base clara, acento azul/indigo), não mais o "Dashboard de Inteligência"
  // grafite+neon da Etapa 18. Dark continua disponível como alternativa.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Reestruturação Visual WowDash (13/10/2026): o template de
        // referência não usa serifada em lugar nenhum — todo texto, de
        // título a número de tabela, é sans (Inter). Em vez de caçar cada
        // `font-serif` espalhado pelo app (29 arquivos), o token em si passa
        // a resolver para Inter: toda classe `font-serif` existente continua
        // válida, só deixa de parecer "premium editorial" e passa a parecer
        // "dashboard SaaS", sem precisar tocar cada arquivo individualmente.
        serif: ['Inter', 'system-ui', 'sans-serif'],
        // Sans densa para números, SKU e tabelas — legibilidade em primeiro lugar.
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ====================================================================
        // Paleta Kyneti "nomeada" — fonte da verdade para os tons em si; os
        // tokens semânticos abaixo (background/foreground/primary/...) só
        // REFERENCIAM estes valores via CSS variable, para que os componentes
        // shadcn (ui/*.tsx) e o dark mode funcionem sem duplicar a paleta.
        //
        // Reestruturação Visual WowDash (13/10/2026): `ink` deixa de ser
        // grafite puro e passa a ser uma escala azul-ardósia/"navy" — o tom
        // de fundo escuro característico de admin dashboards (sidebar/hero
        // escuro com um leve matiz azul, não preto neutro).
        // ====================================================================
        canvas: '#F4F6FA',
        surface: '#FFFFFF',
        ink: {
          950: '#0F1324', // navy profundo — fundo do Dark Mode / hero
          900: '#171B2E',
          800: '#1F2438', // superfícies secundárias no Dark Mode
          700: '#2B3150',
          500: '#8B91AC',
          300: '#D7DAE6',
        },
        // Semáforo de margem (conceito pedido: vermelho/amarelo/verde por faixa).
        margin: {
          danger: '#EF4444',
          warning: '#F59E0B',
          good: '#10B981',
        },
        // Destaque dourado para o canal de melhor margem.
        gold: {
          DEFAULT: '#C9A227',
          light: '#E8CE6B',
          glow: 'rgba(201, 162, 39, 0.55)',
        },
        // Identidade aproximada de cada canal — cores de referência pública
        // das marcas, não validadas pixel a pixel contra o guia de marca
        // oficial de cada uma; ajustar se algum canal tiver guideline exato.
        channel: {
          mercadoLivre: '#FFE600',
          mercadoLivreInk: '#2D3277',
          shopee: '#EE4D2D',
          nuvemshop: '#4A25AA',
        },
        // Acento de marca — Reestruturação Visual WowDash (13/10/2026):
        // o azul neon/cyan "Dashboard de Inteligência" (#00F0FF) dá lugar a
        // um azul-índigo de SaaS dashboard, o acento dominante do template
        // de referência (botão primário, item ativo do menu, anel de foco,
        // glow de KPI/insight de IA, acentos de gráfico). Nome do token
        // (`neon`) mantido de propósito — é referenciado por dezenas de
        // classes (`bg-neon`, `text-accent`, `shadow-neonGlow`,
        // `animate-neonPulse`) em todo o app; renomear exigiria editar cada
        // arquivo só por estética de nome, sem ganho visual.
        neon: {
          DEFAULT: '#4F46E5',
          dim: 'rgba(79, 70, 229, 0.12)',
          glow: 'rgba(79, 70, 229, 0.55)',
        },

        // ====================================================================
        // Tokens semânticos shadcn/ui — consumidos pelos primitivos em
        // src/components/ui/*.tsx (Button, Card, Badge, ...). Cada um lê uma
        // CSS variable (ver src/styles/index.css, blocos :root e .dark) no
        // formato "R G B" espaço-separado, para os modificadores de opacidade
        // do Tailwind funcionarem (`bg-primary/60` etc.), mesmo padrão já
        // usado em `bg-neon/10` na paleta nomeada acima.
        //
        // Racional de cor por tema (Reestruturação WowDash): o azul-índigo
        // de marca (`accent`, ver `neon` acima) é também o `primary` padrão
        // em ambos os temas — botão de ação principal, item ativo do menu —
        // igual ao template de referência, onde o azul do botão primário é
        // a mesma cor do destaque. `ring`/foco usa o mesmo tom.
        // ====================================================================
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
          foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        goldGlow: '0 0 0 1px rgba(201,162,39,0.6), 0 0 24px 4px rgba(201,162,39,0.35)',
        neonGlow: '0 0 0 1px rgba(79,70,229,0.5), 0 0 20px 2px rgba(79,70,229,0.30)',
      },
      keyframes: {
        goldPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(201,162,39,0.6), 0 0 18px 2px rgba(201,162,39,0.30)' },
          '50%': { boxShadow: '0 0 0 1px rgba(201,162,39,0.8), 0 0 30px 6px rgba(201,162,39,0.55)' },
        },
        neonPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(79,70,229,0.45), 0 0 14px 1px rgba(79,70,229,0.25)' },
          '50%': { boxShadow: '0 0 0 1px rgba(79,70,229,0.75), 0 0 22px 4px rgba(79,70,229,0.5)' },
        },
        // Feedback visual da tela de Conferência (Sprint 27, Item 2 da fila
        // de validação em produção — ver ConferenciaDetalhePage.tsx).
        // Tremor curto no campo de bipagem quando um SKU é rejeitado —
        // reforça o beep de erro sem precisar o operador ler o texto.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(6px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        // Ponto vermelho pulsante do indicador "Gravando" — o mesmo padrão
        // visual de um REC de câmera de verdade.
        recPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        // Flash verde breve na linha do checklist recém-bipada.
        scanFlash: {
          '0%': { backgroundColor: 'rgba(16,185,129,0.35)' },
          '100%': { backgroundColor: 'rgba(16,185,129,0)' },
        },
      },
      animation: {
        goldPulse: 'goldPulse 2.4s ease-in-out infinite',
        neonPulse: 'neonPulse 2.2s ease-in-out infinite',
        shake: 'shake 0.4s ease-in-out',
        recPulse: 'recPulse 1.2s ease-in-out infinite',
        scanFlash: 'scanFlash 0.9s ease-out',
      },
    },
  },
  // tailwindcss-animate: fornece as classes utilitárias animate-in/animate-out
  // (data-[state=open]:animate-in, fade-in-0, zoom-in-95, slide-in-from-*...)
  // consumidas pelos primitivos Radix em src/components/ui/ (dropdown-menu,
  // tooltip). Sem isso eles ainda funcionam, só aparecem/somem sem transição.
  plugins: [tailwindcssAnimate],
};
