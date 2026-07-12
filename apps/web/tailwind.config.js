/** @type {import('tailwindcss').Config} */
export default {
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
        // Fundo claro/neutro para não competir com fotos de produto.
        canvas: '#F8F9FA',
        surface: '#FFFFFF',
        ink: {
          900: '#1A1A1E',
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
  plugins: [],
};
