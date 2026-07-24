import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode via classe `.dark` na tag <html> (ver src/features/theme/theme-context.tsx)
  // — não `media` (preferência do SO): "tecnológico" é o padrão DA MARCA,
  // não uma escolha do sistema operacional do usuário. Ver seção 2 do pedido
  // do usuário: dark é o padrão, light é a alternativa.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Serifada para títulos/nome de produto — estética premium pedida.
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        // Sans densa para números, SKU e tabelas — legibilidade em primeiro lugar.
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ====================================================================
        // Paleta Kyneti "nomeada" (histórica, Etapa 18) — mantida intacta,
        // NENHUM arquivo existente quebra. Continua a fonte da verdade para
        // os tons em si; os tokens semânticos abaixo (background/foreground/
        // primary/...) só REFERENCIAM estes valores via CSS variable, para
        // que os componentes shadcn (ui/*.tsx) e o dark mode funcionem sem
        // duplicar a paleta.
        // ====================================================================
        canvas: '#F8F9FA',
        surface: '#FFFFFF',
        ink: {
          950: '#0D0D0F', // grafite profundo — fundo do Dark Mode (padrão tecnológico)
          900: '#1A1A1E',
          800: '#27272C', // tom médio novo — superfícies secundárias no Dark Mode
          700: '#3F3F46',
          500: '#71717A',
          300: '#D4D4D8',
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
        // Identidade Kyneti (Etapa 18, telas de Dashboard/Pedidos) — "cinza
        // chumbo, fundo branco, detalhes azul neon". O chumbo/fundo branco JÁ
        // é a paleta `ink`/`canvas`/`surface` acima (não duplicada de
        // propósito); `neon` é o único tom novo, reservado para o acento de
        // alta intelligence (KPIs em destaque, insights de IA, estados
        // críticos que pedem atenção imediata) — nunca usado como cor de
        // texto padrão, que continua sendo `ink`.
        neon: {
          DEFAULT: '#00F0FF',
          dim: 'rgba(0, 240, 255, 0.12)',
          glow: 'rgba(0, 240, 255, 0.55)',
        },

        // ====================================================================
        // Tokens semânticos shadcn/ui — consumidos pelos primitivos em
        // src/components/ui/*.tsx (Button, Card, Badge, ...). Cada um lê uma
        // CSS variable (ver src/styles/index.css, blocos :root e .dark) no
        // formato "R G B" espaço-separado, para os modificadores de opacidade
        // do Tailwind funcionarem (`bg-primary/60` etc.), mesmo padrão já
        // usado em `bg-neon/10` na paleta nomeada acima.
        //
        // Racional de cor por tema (pedido do usuário): grafite é a BASE em
        // ambos os temas; neon é sempre "destaque", nunca a cor de fundo de
        // botão padrão — no Dark Mode, `primary` vira um neutro claro (alto
        // contraste sobre grafite profundo), não neon, para não virar um
        // painel "néon por toda parte" (o pedido foi "sério, robusto,
        // tecnológico", não estética de vitrine). Neon continua reservado
        // para: anel de foco, indicador ativo do menu, glow de KPI em
        // destaque, e acentos de gráfico.
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
        neonGlow: '0 0 0 1px rgba(0,240,255,0.5), 0 0 20px 2px rgba(0,240,255,0.30)',
      },
      keyframes: {
        goldPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(201,162,39,0.6), 0 0 18px 2px rgba(201,162,39,0.30)' },
          '50%': { boxShadow: '0 0 0 1px rgba(201,162,39,0.8), 0 0 30px 6px rgba(201,162,39,0.55)' },
        },
        neonPulse: {
          '0%, 100%': { boxShadow: '0 0 0 1px rgba(0,240,255,0.45), 0 0 14px 1px rgba(0,240,255,0.25)' },
          '50%': { boxShadow: '0 0 0 1px rgba(0,240,255,0.75), 0 0 22px 4px rgba(0,240,255,0.5)' },
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
