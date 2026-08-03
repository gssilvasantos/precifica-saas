// Porta exposta pelo Marketplace Publishing, consumida pelo Pricing
// Intelligence (01/08/2026 — ver docs/revisao-geral-2026-08.md, §1).
//
// POR QUE ELA EXISTE: a comissão de um marketplace não é um número único
// por canal — ela varia por CATEGORIA (o Mercado Livre cobra percentuais
// diferentes para Eletrônicos e para Moda, por exemplo). O
// MercadoLivreFeeRuleProvider já importa as regras exatamente assim: uma
// MarketplaceRule por categoria do canal, com `scopeKey` = o id externo da
// categoria (MLBxxxx). Para o motor de preço resolver a taxa CERTA de um
// produto, ele precisa traduzir "categoria interna do meu catálogo" para
// "categoria daquele marketplace" — que é justamente o vínculo que o
// ChannelCategoryMapping já guarda desde a Fase 4 do benchmark Tiny.
//
// Sem esta porta, o Pricing só conseguiria pedir uma taxa genérica, o que
// contraria o princípio de produto definido pelo usuário: as taxas são
// IMPORTADAS do marketplace com a especificidade real de cada canal, nunca
// achatadas num valor médio.
//
// Retorna null quando não há mapeamento configurado para aquela
// categoria/canal — quem chama decide o que fazer (o
// PricingDecisionService tenta o escopo GLOBAL antes de desistir, e nunca
// assume comissão zero).
export interface ChannelCategoryResolver {
  resolveExternalCategoryId(tenantId: string, internalCategoryId: string, marketplaceCode: string): Promise<string | null>;
}
