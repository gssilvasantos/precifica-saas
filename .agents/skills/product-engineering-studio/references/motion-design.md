# Animação e recursos gráficos

## Regra de ouro

Animação existe para **comunicar**: orientar no espaço, mostrar continuidade entre estados, dar
feedback de causa e efeito, ou dirigir atenção uma única vez. Animação decorativa em ferramenta
de uso diário é atrito — o usuário abre a mesma tela cinquenta vezes por dia.

## Escolha da ferramenta

Use **o que o projeto já tem** antes de considerar qualquer coisa nova. Não instale nenhuma
biblioteca desta lista sem necessidade concreta e aprovação explícita do usuário.

| Necessidade | Ferramenta adequada |
|---|---|
| Hover, foco, mudança de cor/opacidade/tamanho | CSS puro (`transition`) |
| Entrada/saída de elemento, skeleton, pulso | Utilitários de animação do Tailwind/CSS keyframes |
| Microinteração, transição de lista, drawer, modal, feedback | Biblioteca de motion declarativa (ex.: Motion/Framer Motion) — só se já existir ou for justificada |
| Timeline complexa, narrativa sincronizada, scroll-telling | GSAP + ScrollTrigger — praticamente só para landing/institucional |
| Rolagem suave "cinematográfica" | Lenis — apenas em experiência de marketing; **nunca** em painel administrativo |
| Experiência 3D | Three.js / React Three Fiber — exige justificativa de produto e orçamento de performance |
| Animação vetorial complexa produzida por designer | Lottie ou Rive |
| Efeito gráfico pontual | SVG, `mask`, `clip-path`, gradiente, Canvas |
| Gráfico de dados | A biblioteca de gráficos **já adotada** pelo projeto; não introduza uma segunda |

## Parâmetros

- **Duração**: 100–200 ms para feedback imediato (hover, toggle); 200–300 ms para transição de
  elemento; acima de 400 ms só em narrativa de marketing.
- **Easing**: saída rápida e entrada suave (`ease-out` para entrada, `ease-in` para saída).
  Linear só para progresso contínuo.
- **Propriedades**: anime `transform` e `opacity`. Anime `width`/`height`/`top`/`left` só quando
  não houver alternativa — causa layout e engasgo.
- **Orquestração**: escalone listas com atraso pequeno (20–40 ms por item) e limite ao que está
  visível; não anime 200 linhas de tabela.

## Acessibilidade

`prefers-reduced-motion` é **obrigatório**, não opcional:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Em bibliotecas de motion, use o hook/flag equivalente e **substitua** a animação por uma
transição instantânea — não apenas a acelere. Nada essencial pode depender de movimento para ser
compreendido.

## Desempenho

- Orçamento: animação não pode custar mais do que a interação que ela decora.
- Sem animação em loop infinito fora da tela.
- Sem biblioteca pesada carregada na rota inicial por causa de um único efeito — faça code
  splitting.
- Meça em máquina modesta, não só na sua.

## Por tipo de produto

- **SaaS/admin/ERP/dashboard**: rápido e funcional. Skeleton no carregamento, transição curta em
  modal/drawer, destaque discreto em linha alterada, feedback imediato em ação. Nada de parallax,
  scroll hijacking, ou entrada animada em tabela.
- **Landing page/institucional**: expressividade permitida — ainda assim com orçamento de
  performance (LCP/CLS), conteúdo legível sem JavaScript, e `prefers-reduced-motion` respeitado.
  **Nunca misture o bundle do site institucional com o do aplicativo.**

## Antes de aprovar uma animação

- [ ] Ela comunica algo que a tela estática não comunica?
- [ ] Continua boa na centésima vez?
- [ ] Respeita `prefers-reduced-motion`?
- [ ] Usa `transform`/`opacity`?
- [ ] Não atrasa a percepção de conclusão da ação?
- [ ] Não exigiu dependência nova sem aprovação?
