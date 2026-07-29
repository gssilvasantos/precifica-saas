import { Injectable } from '@nestjs/common';
import { FreightLabelInput, FreightLabelProvider, FreightLabelResult } from '../../application/freight-label-provider.contract';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { CorreiosApiClient, CorreiosCredential } from './correios-api.client';

@Injectable()
export class CorreiosFreightProvider implements FreightLabelProvider {
  readonly providerCode = 'CORREIOS';

  constructor(
    private readonly client: CorreiosApiClient,
    private readonly connections: FreightProviderConnectionService,
  ) {}

  async generateLabel(tenantId: string, input: FreightLabelInput): Promise<FreightLabelResult> {
    try {
      const credential = await this.connections.requireCredential<CorreiosCredential>(tenantId, this.providerCode);
      const result = await this.client.createLabel(credential, {
        toPostalCode: input.recipientAddress.postalCode,
        toName: input.recipientAddress.name,
        toAddress: input.recipientAddress.street,
        toNumber: input.recipientAddress.number,
        toDistrict: input.recipientAddress.neighborhood,
        toCity: input.recipientAddress.city,
        toState: input.recipientAddress.state,
        weightKg: input.packageWeightKg,
        declaredValue: input.declaredValue ?? 0,
        avisoRecebimento: input.avisoRecebimento ?? false,
        maoPropria: input.maoPropria ?? false,
      });
      if (!result.trackingCode) {
        return { success: false, message: 'Correios não devolveu código de objeto para a pré-postagem.' };
      }
      return { success: true, trackingCode: result.trackingCode, labelUrl: result.labelUrl };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }
}
