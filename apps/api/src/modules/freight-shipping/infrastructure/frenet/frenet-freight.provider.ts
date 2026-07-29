import { Injectable } from '@nestjs/common';
import { FreightLabelInput, FreightLabelProvider, FreightLabelResult } from '../../application/freight-label-provider.contract';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { FrenetApiClient, FrenetCredential } from './frenet-api.client';

// A Frenet fica registrada no FreightProviderRegistry (o tenant pode
// configurar a conexão e escolher "FRENET" como forma de envio de um lote),
// mas generateLabel é honesto sobre a limitação: devolve a MELHOR cotação
// encontrada na mensagem de erro, para o operador decidir manualmente e
// gerar a etiqueta pelo painel Frenet/transportadora, em vez de fingir que
// automatizamos uma emissão que a API pública não expõe de forma
// padronizada. Ver AVISO DE HONESTIDADE em frenet-api.client.ts.
@Injectable()
export class FrenetFreightProvider implements FreightLabelProvider {
  readonly providerCode = 'FRENET';

  constructor(
    private readonly client: FrenetApiClient,
    private readonly connections: FreightProviderConnectionService,
  ) {}

  async generateLabel(tenantId: string, input: FreightLabelInput): Promise<FreightLabelResult> {
    try {
      const credential = await this.connections.requireCredential<FrenetCredential>(tenantId, this.providerCode);
      const quotes = await this.client.getQuote(credential, {
        toPostalCode: input.recipientAddress.postalCode,
        weightKg: input.packageWeightKg,
        declaredValue: input.declaredValue ?? 0,
      });
      if (quotes.length === 0) {
        return { success: false, message: 'Frenet não retornou nenhuma cotação para este destino/peso.' };
      }
      const best = quotes.reduce((min, q) => (q.price < min.price ? q : min), quotes[0]);
      return {
        success: false,
        message: `Frenet neste MVP só cota frete, não emite etiqueta automaticamente — melhor opção: ${best.carrierName}, R$ ${best.price.toFixed(2)}, ${best.deliveryDays} dia(s). Gere a etiqueta pelo painel da transportadora e registre o rastreio manualmente.`,
      };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }
}
