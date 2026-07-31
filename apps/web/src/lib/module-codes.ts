// Espelho do enum do backend (apps/api/src/shared/access-control/module-code.ts)
// — frontend e backend são pacotes separados (sem tipos compartilhados), então
// os valores de string precisam ser mantidos idênticos manualmente. Usado em
// dois lugares: Sidebar.tsx (esconder item de menu sem acesso — só UX, o
// backend já bloqueia de verdade via ModuleAccessGuard) e TeamPage.tsx
// (checkboxes de módulo no convite/edição de colaborador).
export type ModuleCode =
  | 'ORDERS'
  | 'ADS'
  | 'CATALOG'
  | 'PROMOTIONS'
  | 'FINANCE'
  | 'REPLENISHMENT'
  | 'CONFERENCE'
  | 'INTEGRATIONS'
  | 'FISCAL_SETTINGS';

export const ALL_MODULE_CODES: ModuleCode[] = [
  'ORDERS',
  'ADS',
  'CATALOG',
  'PROMOTIONS',
  'FINANCE',
  'REPLENISHMENT',
  'CONFERENCE',
  'INTEGRATIONS',
  'FISCAL_SETTINGS',
];

export const MODULE_LABEL: Record<ModuleCode, string> = {
  ORDERS: 'Pedidos',
  ADS: 'Ads',
  CATALOG: 'Catálogo e Governança MAP',
  PROMOTIONS: 'Promoções',
  FINANCE: 'Financeiro',
  REPLENISHMENT: 'Abastecimento',
  CONFERENCE: 'Conferência',
  INTEGRATIONS: 'Integrações',
  FISCAL_SETTINGS: 'Configurações Fiscais',
};
