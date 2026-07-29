import { Injectable } from '@nestjs/common';
import { FreightLabelInput, FreightLabelProvider, FreightLabelResult } from '../../application/freight-label-provider.contract';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { MelhorEnvioApiClient, MelhorEnvioCredential } from './melhor-envio-api.client';

@Injectable()
export class MelhorEnvioFreightProvider implements FreightLabelProvider {
  readonly providerCode = 'MELHOR_ENVIO';

  constructor(
    private readonly client: MelhorEnvioApiClient,
    private readonly connections: FreightProviderConnectionService,
  ) {}

  async generateLabel(tenantId: string, input: FreightLabelInput): Promise<FreightLabelResult> {
    try {
      const credential = await this.connections.requireCredential<MelhorEnvioCredential>(tenantId, this.providerCode);
      const result = await this.client.generateLabel(credential, {
        toPostalCode: input.recipientAddress.postalCode,
        toName: input.recipientAddress.name,
        toDocument: input.recipientAddress.document,
        toAddress: input.recipientAddress.street,
        toNumber: input.recipientAddress.number,
        toDistrict: input.recipientAddress.neighborhood,
        toCity: input.recipientAddress.city,
        toState: input.recipientAddress.state,
        weightKg: input.packageWeightKg,
        declaredValue: input.declaredValue ?? 0,
        avisoRecebimento: input.avisoRecebimento ?? false,
        maoPropria: input.maoPropria ?? false,
        orderReference: input.orderReference,
      });
      if (!result.labelUrl && !result.trackingCode) {
        return { success: false, message: 'Melhor Envio não devolveu etiqueta nem código de rastreio.' };
      }
      return { success: true, trackingCode: result.trackingCode, labelUrl: result.labelUrl };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }
}
