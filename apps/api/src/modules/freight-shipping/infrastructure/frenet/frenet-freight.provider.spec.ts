import { FrenetFreightProvider } from './frenet-freight.provider';
import { FrenetApiClient } from './frenet-api.client';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { FreightLabelInput } from '../../application/freight-label-provider.contract';

function buildInput(): FreightLabelInput {
  return {
    orderReference: 'ML-999',
    packageWeightKg: 1,
    declaredValue: 100,
    recipientAddress: {
      name: 'Cliente Teste',
      street: 'Rua B',
      number: '20',
      neighborhood: 'Bairro',
      city: 'Rio de Janeiro',
      state: 'RJ',
      postalCode: '20000-000',
    },
  };
}

describe('FrenetFreightProvider (Fase 5 — quote-only, nunca finge emitir etiqueta)', () => {
  function buildProvider() {
    const client = { getQuote: jest.fn() } as unknown as jest.Mocked<FrenetApiClient>;
    const connections = { requireCredential: jest.fn() } as unknown as jest.Mocked<FreightProviderConnectionService>;
    const provider = new FrenetFreightProvider(client, connections);
    return { provider, client, connections };
  }

  it('declara providerCode FRENET', () => {
    const { provider } = buildProvider();
    expect(provider.providerCode).toBe('FRENET');
  });

  it('sem conexão configurada: devolve success false, nunca lança', async () => {
    const { provider, connections } = buildProvider();
    connections.requireCredential.mockRejectedValue(new Error('Conexão não configurada para FRENET.'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result).toEqual({ success: false, message: 'Conexão não configurada para FRENET.' });
  });

  it('nenhuma cotação retornada: devolve success false com mensagem explicativa', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ token: 'token', fromPostalCode: '01000-000' });
    client.getQuote.mockResolvedValue([]);

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result).toEqual({ success: false, message: 'Frenet não retornou nenhuma cotação para este destino/peso.' });
  });

  it('sempre devolve success false mesmo com cotação disponível — nunca finge emitir etiqueta automaticamente', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ token: 'token', fromPostalCode: '01000-000' });
    client.getQuote.mockResolvedValue([
      { carrierName: 'Jadlog', price: 25.9, deliveryDays: 5 },
      { carrierName: 'Correios', price: 19.5, deliveryDays: 7 },
    ]);

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Correios/);
    expect(result.message).toMatch(/19\.50|19,50/);
  });

  it('falha do client (ex.: HTTP não-ok): devolve success false com a mensagem do erro', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ token: 'token', fromPostalCode: '01000-000' });
    client.getQuote.mockRejectedValue(new Error('Frenet /shipping/quote retornou HTTP 500'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result).toEqual({ success: false, message: 'Frenet /shipping/quote retornou HTTP 500' });
  });
});
