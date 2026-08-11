// Fronteira pública do Tax Intelligence (11/08/2026).
//
// Único ponto de import para outros módulos. Antes disto o módulo não tinha
// fronteira declarada: quem quisesse consumi-lo teria que alcançar
// application/ ou domain/ por caminho relativo, que é justamente o acoplamento
// que a arquitetura proíbe.
//
// O que NÃO sai daqui, de propósito: os repositórios, as tabelas dos Anexos
// I a V, o cálculo do RBT12 e o do DAS. Nenhum outro módulo precisa saber o
// que é faixa nem parcela a deduzir — precisam de uma alíquota e da memória de
// cálculo que a justifica.
//
// O consumo em runtime continua sendo por TOKEN (TAX_RATE_RESOLVER, em
// shared/contracts/tokens), nunca pela classe concreta. Este arquivo exporta
// TIPOS e o módulo Nest — não a implementação.

export { TaxIntelligenceModule } from './tax-intelligence.module';

// Contrato de saída. Reexportado a partir de shared/contracts para que o
// consumidor tenha um import só, sem precisar saber que a porta mora em
// shared/ e a implementação aqui.
export type {
  ResolvedTaxRate,
  TaxIncidence,
  TaxRateBreakdown,
  TaxRateQuery,
  TaxRateResolver,
  TaxRateSource,
  TaxRegime,
} from '../../shared/contracts/tax-rate-resolver.port';

export { TaxRateUnavailableError } from '../../shared/contracts/tax-rate-resolver.port';

// Tipo do anexo do Simples: aparece na resposta da API de cadastro e no
// breakdown, então o consumidor precisa dele para tipar a exibição — mas as
// TABELAS de faixa continuam privadas.
export type { SimplesAnexo } from './domain/simples-nacional';
