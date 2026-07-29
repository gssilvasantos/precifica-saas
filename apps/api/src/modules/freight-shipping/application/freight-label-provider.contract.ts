// Contrato de transportadora AVULSA (Fase 5, benchmark Tiny ERP, 29/07/2026)
// — DIFERENTE de ShippingLabelCapableProvider (shared/contracts/
// marketplace-provider.contract.ts): aquele busca a etiqueta NATIVA de um
// marketplace (Mercado Envios/Shopee Envios) para um pedido já existente;
// este gera uma etiqueta NOVA junto de uma transportadora terceira (Melhor
// Envio, Correios, Frenet), que não sabe nada sobre "pedido do Mercado
// Livre" — só sabe origem, destino, peso e volume.
//
// AVISO DE HONESTIDADE (gap conhecido, ver
// docs/dispatch-batch-architecture.md): nenhum canal hoje captura o endereço
// estruturado do destinatário (Order só guarda buyerTaxId — ver
// shared/contracts/order-fiscal-reader.port.ts). Por isso recipientAddress é
// sempre informado MANUALMENTE por quem aciona a geração de etiqueta (o
// operador já tem o pedido na mão física neste ponto do fluxo), nunca
// resolvido automaticamente a partir do pedido.
export interface FreightRecipientAddress {
  name: string;
  document?: string; // CPF/CNPJ do destinatário — alguns providers exigem
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string; // UF, 2 letras
  postalCode: string; // CEP, só dígitos
}

export interface FreightLabelInput {
  recipientAddress: FreightRecipientAddress;
  packageWeightKg: number;
  declaredValue?: number;
  // Quick Win 6 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 1.6/2 — `LogisticasObjetosDadosDTO`) — serviços adicionais de
  // postagem. avisoRecebimento (AR): o remetente recebe confirmação por
  // escrito de que o destinatário recebeu a encomenda — exigido por alguns
  // clientes/contratos B2B. maoPropria (MP): só o destinatário nomeado pode
  // assinar o recebimento — obrigatório para documentos/produtos de valor.
  // Nem todo provider expõe as duas: ver comentário em cada
  // infrastructure/*-api.client.ts sobre o que de fato é enviado.
  avisoRecebimento?: boolean;
  maoPropria?: boolean;
  // externalOrderId/skuCode do pedido, só para correlação/log do lado do
  // provider — nunca usado para decidir nada aqui.
  orderReference: string;
}

export interface FreightLabelResult {
  success: boolean;
  trackingCode?: string;
  labelUrl?: string;
  message?: string;
}

export interface FreightLabelProvider {
  readonly providerCode: string; // "MELHOR_ENVIO" | "CORREIOS" | "FRENET" — mesmo valor de FreightProviderConnection.providerCode
  generateLabel(tenantId: string, input: FreightLabelInput): Promise<FreightLabelResult>;
}

export const FREIGHT_LABEL_PROVIDERS = Symbol('FREIGHT_LABEL_PROVIDERS');
