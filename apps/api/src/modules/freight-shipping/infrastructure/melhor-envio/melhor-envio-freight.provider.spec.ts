import { MelhorEnvioFreightProvider } from './melhor-envio-freight.provider';
import { MelhorEnvioApiClient } from './melhor-envio-api.client';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { FreightLabelInput } from '../../application/freight-label-provider.contract';

function buildInput(): FreightLabelInput {
  return {
    orderReference: 'ML-999',
    packageWeightKg: 1.5,
    declaredValue: 200,
    recipientAddress: {
      name: 'Cliente Teste',
      street: 'Rua das Flores',
      number: '100',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01000-000',
    },
  };
}

describe('MelhorEnvioFreightProvider (Fase 5, etiqueta avulsa)', () => {
  function buildProvider() {
    const client = { generateLabel: jest.fn() } as unknown as jest.Mocked<MelhorEnvioApiClient>;
    const connections = { requireCredential: jest.fn() } as unknown as jest.Mocked<FreightProviderConnectionService>;
    const provider = new MelhorEnvioFreightProvider(client, connections);
    return { provider, client, connections };
  }

  it('declara providerCode MELHOR_ENVIO', () => {
    const { provider } = buildProvider();
    expect(provider.providerCode).toBe('MELHOR_ENVIO');
  });

  it('sem conexão configurada: devolve success false, nunca lança', async () => {
    const { provider, connections } = buildProvider();
    connections.requireCredential.mockRejectedValue(new Error('Conexão não configurada para MELHOR_ENVIO.'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result).toEqual({ success: false, message: 'Conexão não configurada para MELHOR_ENVIO.' });
  });

  it('falha da API (ex.: saldo insuficiente): devolve success false com a mensagem do erro', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ accessToken: 'token', fromPostalCode: '02000-000' });
    client.generateLabel.mockRejectedValue(new Error('Melhor Envio /me/shipment/checkout retornou HTTP 402 — verifique o saldo da conta.'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/saldo/);
  });

  it('resposta sem labelUrl nem trackingCode: devolve success false', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ accessToken: 'token', fromPostalCode: '02000-000' });
    client.generateLabel.mockResolvedValue({});

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result.success).toBe(false);
  });

  it('sucesso: devolve trackingCode + labelUrl', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ accessToken: 'token', fromPostalCode: '02000-000', serviceId: 1 });
    client.generateLabel.mockResolvedValue({ trackingCode: 'ORD-123', labelUrl: 'https://melhorenvio.com.br/print/ORD-123' });

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(client.generateLabel).toHaveBeenCalledWith(
      { accessToken: 'token', fromPostalCode: '02000-000', serviceId: 1 },
      expect.objectContaining({ toPostalCode: '01000-000', toName: 'Cliente Teste', orderReference: 'ML-999' }),
    );
    expect(result).toEqual({ success: true, trackingCode: 'ORD-123', labelUrl: 'https://melhorenvio.com.br/print/ORD-123' });
  });

  // Quick Win 6 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 1.6/2) — avisoRecebimento/maoPropria propagados para o client,
  // default false quando o operador não marcou nenhum dos dois.
  it('propaga avisoRecebimento/maoPropria para o client quando informados', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ accessToken: 'token', fromPostalCode: '02000-000' });
    client.generateLabel.mockResolvedValue({ trackingCode: 'ORD-124' });

    await provider.generateLabel('tenant-1', { ...buildInput(), avisoRecebimento: true, maoPropria: true });

    expect(client.generateLabel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ avisoRecebimento: true, maoPropria: true }),
    );
  });

  it('default avisoRecebimento/maoPropria para false quando não informados', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({ accessToken: 'token', fromPostalCode: '02000-000' });
    client.generateLabel.mockResolvedValue({ trackingCode: 'ORD-125' });

    await provider.generateLabel('tenant-1', buildInput());

    expect(client.generateLabel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ avisoRecebimento: false, maoPropria: false }),
    );
  });
});
