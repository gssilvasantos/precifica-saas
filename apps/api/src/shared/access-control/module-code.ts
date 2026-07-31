// Vocabulário compartilhado de "módulos" visíveis para o usuário — não existe
// hoje um enum de módulo em lugar nenhum do backend (cada pasta em
// src/modules/* é uma fronteira de arquitetura, não um conceito de produto).
// Este enum é a primeira vez que "módulo" vira algo que o dono da conta pode
// conceder/negar por colaborador (30/07/2026, pedido do usuário — Painel de
// Equipe). Mapeia 1:1 com os itens do menu lateral do frontend
// (apps/web/src/components/Sidebar.tsx), exceto Dashboard (agrega dado de
// vários módulos, não tem um controller próprio pra travar) e Administração
// (já é outro conceito — isPlatformAdmin, cross-tenant).
//
// "Catálogo" e "Governança MAP" viram o MESMO código (CATALOG) porque hoje
// os dois vivem nos mesmos controllers do módulo catalog (ProductsController
// cobre tanto a tela de Catálogo quanto a bulk-import/auditoria de MAP) —
// travar em nível de controller não separa os dois. Documentado explicitamente
// (não é descuido): a tela de Equipe mostra um único checkbox "Catálogo e
// Governança MAP".
export enum ModuleCode {
  ORDERS = 'ORDERS', // Pedidos
  ADS = 'ADS', // Ads
  CATALOG = 'CATALOG', // Produtos + Governança MAP
  PROMOTIONS = 'PROMOTIONS', // Promoções
  FINANCE = 'FINANCE', // Financeiro
  REPLENISHMENT = 'REPLENISHMENT', // Abastecimento
  CONFERENCE = 'CONFERENCE', // Conferência
  INTEGRATIONS = 'INTEGRATIONS', // Integrações
  FISCAL_SETTINGS = 'FISCAL_SETTINGS', // Configurações Fiscais
}

export const ALL_MODULE_CODES: ModuleCode[] = Object.values(ModuleCode);

export const MODULE_LABEL: Record<ModuleCode, string> = {
  [ModuleCode.ORDERS]: 'Pedidos',
  [ModuleCode.ADS]: 'Ads',
  [ModuleCode.CATALOG]: 'Catálogo e Governança MAP',
  [ModuleCode.PROMOTIONS]: 'Promoções',
  [ModuleCode.FINANCE]: 'Financeiro',
  [ModuleCode.REPLENISHMENT]: 'Abastecimento',
  [ModuleCode.CONFERENCE]: 'Conferência',
  [ModuleCode.INTEGRATIONS]: 'Integrações',
  [ModuleCode.FISCAL_SETTINGS]: 'Configurações Fiscais',
};

export function isValidModuleCode(value: string): value is ModuleCode {
  return (ALL_MODULE_CODES as string[]).includes(value);
}
