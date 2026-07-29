import {
  canAddOrderToBatch,
  canCancelBatch,
  canConcludeBatch,
  canGenerateLabelForOrder,
  canIncludeInDispatchBatch,
  KNOWN_FORMA_ENVIO_CODES,
  resolveLabelStrategy,
} from './dispatch-batch.entity';

describe('dispatch-batch.entity (Fase 5, Expedição em lote)', () => {
  describe('resolveLabelStrategy', () => {
    it('MERCADO_ENVIOS resolve para NATIVE_MARKETPLACE com channelCode MERCADO_LIVRE', () => {
      expect(resolveLabelStrategy('MERCADO_ENVIOS')).toEqual({ strategy: 'NATIVE_MARKETPLACE', requiredChannelCode: 'MERCADO_LIVRE' });
    });

    it('SHOPEE_ENVIOS resolve para NATIVE_MARKETPLACE com channelCode SHOPEE', () => {
      expect(resolveLabelStrategy('shopee_envios')).toEqual({ strategy: 'NATIVE_MARKETPLACE', requiredChannelCode: 'SHOPEE' });
    });

    it('CORREIOS/MELHOR_ENVIO/FRENET resolvem para GENERIC_FREIGHT', () => {
      expect(resolveLabelStrategy('CORREIOS')).toEqual({ strategy: 'GENERIC_FREIGHT', freightProviderCode: 'CORREIOS' });
      expect(resolveLabelStrategy('MELHOR_ENVIO')).toEqual({ strategy: 'GENERIC_FREIGHT', freightProviderCode: 'MELHOR_ENVIO' });
      expect(resolveLabelStrategy('FRENET')).toEqual({ strategy: 'GENERIC_FREIGHT', freightProviderCode: 'FRENET' });
    });

    it('formas puramente organizacionais (Transportadora, Retirar pessoalmente...) resolvem para NONE', () => {
      expect(resolveLabelStrategy('TRANSPORTADORA')).toEqual({ strategy: 'NONE' });
      expect(resolveLabelStrategy('RETIRAR_PESSOALMENTE')).toEqual({ strategy: 'NONE' });
      expect(resolveLabelStrategy('MOTOBOY')).toEqual({ strategy: 'NONE' });
    });

    it('OLIST_ENVIOS/NUVEM_ENVIO/TIKTOK_SHIPPING (sem API pública conhecida) resolvem para NONE', () => {
      expect(resolveLabelStrategy('OLIST_ENVIOS')).toEqual({ strategy: 'NONE' });
      expect(resolveLabelStrategy('NUVEM_ENVIO')).toEqual({ strategy: 'NONE' });
      expect(resolveLabelStrategy('TIKTOK_SHIPPING')).toEqual({ strategy: 'NONE' });
    });

    it('valor desconhecido (forma de envio nova, não mapeada) cai em NONE, nunca lança', () => {
      expect(resolveLabelStrategy('TRANSPORTADORA_NOVA_XYZ')).toEqual({ strategy: 'NONE' });
    });
  });

  describe('canAddOrderToBatch', () => {
    it('rejeita se o lote não estiver ABERTO', () => {
      const result = canAddOrderToBatch({ status: 'ETIQUETADO' }, null);
      expect(result.ok).toBe(false);
    });

    it('rejeita se o pedido já estiver em outro lote ativo', () => {
      const result = canAddOrderToBatch({ status: 'ABERTO' }, { dispatchBatchId: 'outro-lote' });
      expect(result.ok).toBe(false);
    });

    it('aceita lote ABERTO sem vínculo ativo prévio', () => {
      expect(canAddOrderToBatch({ status: 'ABERTO' }, null).ok).toBe(true);
    });
  });

  describe('canIncludeInDispatchBatch (gate de elegibilidade — Pick & Pack já conferido)', () => {
    it('rejeita se não houver evento de auditoria', () => {
      expect(canIncludeInDispatchBatch(null).ok).toBe(false);
    });

    it('rejeita se o eventType não for RETAIL_SHIPMENT', () => {
      const result = canIncludeInDispatchBatch({ eventType: 'FULL_DISPATCH', conferenceStatus: 'APROVADO' });
      expect(result.ok).toBe(false);
    });

    it('rejeita se a conferência ainda não estiver APROVADA', () => {
      const result = canIncludeInDispatchBatch({ eventType: 'RETAIL_SHIPMENT', conferenceStatus: 'PENDENTE' });
      expect(result.ok).toBe(false);
    });

    it('aceita RETAIL_SHIPMENT já APROVADO', () => {
      const result = canIncludeInDispatchBatch({ eventType: 'RETAIL_SHIPMENT', conferenceStatus: 'APROVADO' });
      expect(result.ok).toBe(true);
    });
  });

  describe('canGenerateLabelForOrder', () => {
    it('rejeita se já estiver ETIQUETADO', () => {
      expect(canGenerateLabelForOrder({ status: 'ETIQUETADO' }).ok).toBe(false);
    });

    it('aceita PENDENTE ou ERRO (permite tentar de novo)', () => {
      expect(canGenerateLabelForOrder({ status: 'PENDENTE' }).ok).toBe(true);
      expect(canGenerateLabelForOrder({ status: 'ERRO' }).ok).toBe(true);
    });
  });

  describe('canConcludeBatch', () => {
    it('rejeita lote sem nenhum pedido', () => {
      const result = canConcludeBatch({ status: 'ABERTO', formaEnvio: 'CORREIOS' }, []);
      expect(result.ok).toBe(false);
    });

    it('forma de envio NONE (ex.: Retirar pessoalmente) conclui mesmo com pedidos PENDENTE', () => {
      const result = canConcludeBatch({ status: 'ABERTO', formaEnvio: 'RETIRAR_PESSOALMENTE' }, [{ status: 'PENDENTE' }]);
      expect(result.ok).toBe(true);
    });

    it('forma de envio com etiqueta real rejeita se algum pedido ainda não está ETIQUETADO', () => {
      const result = canConcludeBatch({ status: 'ABERTO', formaEnvio: 'CORREIOS' }, [{ status: 'ETIQUETADO' }, { status: 'PENDENTE' }]);
      expect(result.ok).toBe(false);
    });

    it('forma de envio com etiqueta real aceita quando todo pedido está ETIQUETADO', () => {
      const result = canConcludeBatch({ status: 'ABERTO', formaEnvio: 'CORREIOS' }, [{ status: 'ETIQUETADO' }, { status: 'ETIQUETADO' }]);
      expect(result.ok).toBe(true);
    });

    it('rejeita lote já DESPACHADO/CANCELADO', () => {
      expect(canConcludeBatch({ status: 'DESPACHADO', formaEnvio: 'CORREIOS' }, [{ status: 'ETIQUETADO' }]).ok).toBe(false);
      expect(canConcludeBatch({ status: 'CANCELADO', formaEnvio: 'CORREIOS' }, [{ status: 'ETIQUETADO' }]).ok).toBe(false);
    });
  });

  describe('canCancelBatch', () => {
    it('rejeita lote já DESPACHADO ou CANCELADO', () => {
      expect(canCancelBatch({ status: 'DESPACHADO' }).ok).toBe(false);
      expect(canCancelBatch({ status: 'CANCELADO' }).ok).toBe(false);
    });

    it('aceita lote ABERTO ou ETIQUETADO', () => {
      expect(canCancelBatch({ status: 'ABERTO' }).ok).toBe(true);
      expect(canCancelBatch({ status: 'ETIQUETADO' }).ok).toBe(true);
    });
  });
});
