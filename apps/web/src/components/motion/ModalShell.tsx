import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

// Shell animado para os modais do sistema (ProductForm, GenerateVariantsDialog
// e futuros) — pedido do usuário (13/10/2026: "motion action, tudo de mais
// moderno"). Antes disto cada modal reimplementava seu próprio
// `fixed inset-0 bg-background/70 backdrop-blur-sm` estático; agora o
// backdrop faz fade-in e o painel sobe com leve scale, um único lugar para
// manter esse comportamento.
//
// LIMITAÇÃO CONHECIDA (documentada por transparência, regra de testes/docs
// do projeto): só anima ENTRADA. Fechar ainda desmonta na hora (sem fade de
// saída) porque o `AnimatePresence` do Framer Motion precisa envolver o
// ponto onde o chamador decide "renderizar ou não" (`{form && <...>}`), que
// fica em cada página que abre o modal — não aqui dentro. Animar a saída
// também exigiria tocar cada chamador; ficou fora desta rodada por escopo.
export default function ModalShell({ onClose, children, maxWidthClassName = 'max-w-3xl' }: Props) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className={cn('my-8 w-full', maxWidthClassName)}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
