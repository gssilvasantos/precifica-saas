import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

// Entrada em cascata para grades de cards/listas (KPIs do Dashboard, cards
// de resumo do Catálogo, linhas de ROI por canal, etc.) — pedido do
// usuário (13/10/2026) por "motion action" no sistema todo. `Stagger` é o
// container (define o intervalo entre os filhos) e `RevealItem` é cada
// filho (sobe ~8px + aparece). Roda só na MONTAGEM do container — reabrir
// a mesma lista sem desmontar não re-anima (comportamento esperado: é
// uma apresentação de entrada, não um efeito a cada render).
//
// `as`/`itemAs`: motion.div por padrão, mas aceitam 'ul'/'li' (via
// `motion(...)` não é viável de forma genérica sem gerar componentes extras,
// então aqui usamos elemento HTML comum + framer-motion's suporte nativo a
// qualquer tag via `motion.create` ficaria over-engineering para o uso atual
// — ver nota abaixo).
const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

// Mapa fixo (em vez de `motion[as]` dinâmico, que o TypeScript não tipa bem)
// — cobre os casos reais do projeto: grade de cards (div) e lista (ul/li).
const MotionTag = {
  div: motion.div,
  ul: motion.ul,
  li: motion.li,
};

interface StaggerProps {
  children: ReactNode;
  className?: string;
  as?: keyof typeof MotionTag;
}

export function Stagger({ children, className, as = 'div' }: StaggerProps) {
  const Comp = MotionTag[as];
  return (
    <Comp className={className} variants={containerVariants} initial="hidden" animate="show">
      {children}
    </Comp>
  );
}

export function RevealItem({ children, className, as = 'div' }: StaggerProps) {
  const Comp = MotionTag[as];
  return (
    <Comp className={className} variants={itemVariants}>
      {children}
    </Comp>
  );
}
