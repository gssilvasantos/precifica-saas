// Porta exposta pelo Tax Intelligence e consumida pelo ERP Integration
// (13/08/2026).
//
// POR QUE EXISTE. O Olist entrega NCM em 100% dos produtos importados. Exigir
// que o lojista reclassifique cada SKU à mão seria refazer um dado que a fonte
// da verdade do catálogo já traz — e com 249 SKUs, na prática significaria
// nunca classificar.
//
// O importador NÃO sabe derivar nada: ele passa o NCM e a UF, e quem aplica a
// norma é o Tax Intelligence. Nenhuma regra fiscal atravessa a fronteira — o
// ERP Integration não conhece Lei 10.147/2000 nem Portaria SRE 94/2025, do
// mesmo jeito que não conhece RBT12.

export interface ClassificacaoDeProdutoInput {
  tenantId: string;
  productId: string;
  // Como veio do ERP; pode ser null (cadastro incompleto é comum e legítimo).
  ncm: string | null;
  // Data do sync. A mesma classificação muda antes e depois de uma portaria.
  at: Date;
}

export interface ProductTaxClassifier {
  // Idempotente: rodar de novo com o mesmo NCM não cria vigência duplicada.
  // Devolve `true` quando classificou, `false` quando não havia regra com
  // fonte para aquele NCM/UF/data — e nesse caso NADA é gravado, para o motor
  // continuar bloqueando em vez de precificar sobre um palpite.
  classificarDoErp(input: ClassificacaoDeProdutoInput): Promise<boolean>;
}
