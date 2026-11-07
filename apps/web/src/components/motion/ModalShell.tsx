import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}

// Seletor dos elementos que o foco pode alcançar dentro do painel — mesma
// lista usada em bibliotecas de focus trap conhecidas (ex. focus-trap-js).
// `[tabindex]` exclui `tabindex="-1"` porque esse valor existe justamente
// para TIRAR o elemento da navegação por Tab.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shell animado para os modais do sistema (ProductForm, GenerateVariantsDialog
// e futuros) — pedido do usuário (13/10/2026: "motion action, tudo de mais
// moderno"). Antes disto cada modal reimplementava seu próprio
// `fixed inset-0 bg-background/70 backdrop-blur-sm` estático; agora o
// backdrop faz fade-in e o painel sobe com leve scale, um único lugar para
// manter esse comportamento.
//
// Foco preso, Esc fecha e foco volta ao gatilho (20/10/2026 — achado da
// auditoria de acessibilidade, skill `accessibility`: nenhum modal do
// projeto implementava isso, apesar de `.claude/rules/frontend.md` listar
// como obrigatório para modal/drawer). Centralizado aqui, não em cada
// chamador — ProductForm não tinha NENHUM tratamento de teclado;
// GenerateVariantsDialog só tinha Escape, duplicado por página. Removido de
// lá para não ficar dois listeners de Escape concorrendo.
//
// LIMITAÇÃO CONHECIDA (documentada por transparência, regra de testes/docs
// do projeto): só anima ENTRADA. Fechar ainda desmonta na hora (sem fade de
// saída) porque o `AnimatePresence` do Framer Motion precisa envolver o
// ponto onde o chamador decide "renderizar ou não" (`{form && <...>}`), que
// fica em cada página que abre o modal — não aqui dentro. Animar a saída
// também exigiria tocar cada chamador; ficou fora desta rodada por escopo.
export default function ModalShell({ onClose, children, maxWidthClassName = 'max-w-3xl' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const triggerElement = document.activeElement as HTMLElement | null;

    // Foco inicial: primeiro elemento focável do painel (um input de
    // formulário, por exemplo) — se não houver nenhum, o próprio painel
    // (por isso o `tabIndex={-1}` no container abaixo).
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables?.[0] ?? panelRef.current)?.focus();

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !panelRef.current) return;

      // Trap: Tab/Shift+Tab nunca saem do painel. Reconsulta os focáveis a
      // cada tecla (não guarda em ref) porque o conteúdo do modal muda
      // dinamicamente (ex.: linhas de variação adicionadas/removidas).
      const elements = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      // Foco volta para quem abriu o modal — sem isso, um usuário de
      // teclado/leitor de tela perde a posição ao fechar.
      triggerElement?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn('my-8 w-full outline-none', maxWidthClassName)}
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
