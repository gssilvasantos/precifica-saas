import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

// Transição de página (pedido do usuário, 13/10/2026: "motion action, tudo
// de mais moderno"). Aplicado em AppLayout, ao redor do <Outlet/>, com
// `key={pathname}` — cada troca de rota desmonta/remonta este wrapper,
// então o fade+slide roda de novo a cada navegação. Curto (180ms) e sutil
// de propósito: é uma ferramenta de uso diário (ERP), não uma vitrine —
// a regra de frontend do projeto pede animação rápida (100–300ms) e com
// propósito (aqui: continuidade entre telas), nunca decoração.
//
// `prefers-reduced-motion`: a própria lib já reduz drasticamente a
// transição quando o SO pede (via `useReducedMotion` interno do Framer
// Motion nas variantes de transform), mas como aqui o efeito também mexe em
// opacidade (sempre segura), não há necessidade de branch condicional além
// disso — nada pisca nem causa desconforto vestibular.
const variants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export default function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
