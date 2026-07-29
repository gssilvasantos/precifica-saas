import { CorreiosFreightProvider } from './correios-freight.provider';
import { CorreiosApiClient } from './correios-api.client';
import { FreightProviderConnectionService } from '../../application/freight-provider-connection.service';
import { FreightLabelInput } from '../../application/freight-label-provider.contract';

function buildInput(): FreightLabelInput {
  return {
    orderReference: 'ML-999',
    packageWeightKg: 0.8,
    declaredValue: 150,
    recipientAddress: {
      name: 'Cliente Teste',
      street: 'Av. Principal',
      number: '50',
      neighborhood: 'Jardins',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '04000-000',
    },
  };
}

describe('CorreiosFreightProvider (Fase 5, etiqueta avulsa)', () => {
  function buildProvider() {
    const client = { createLabel: jest.fn() } as unknown as jest.Mocked<CorreiosApiClient>;
    const connections = { requireCredential: jest.fn() } as unknown as jest.Mocked<FreightProviderConnectionService>;
    const provider = new CorreiosFreightProvider(client, connections);
    return { provider, client, connections };
  }

  it('declara providerCode CORREIOS', () => {
    const { provider } = buildProvider();
    expect(provider.providerCode).toBe('CORREIOS');
  });

  it('sem conexão configurada: devolve success false, nunca lança', async () => {
    const { provider, connections } = buildProvider();
    connections.requireCredential.mockRejectedValue(new Error('Conexão não configurada para CORREIOS.'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result).toEqual({ success: false, message: 'Conexão não configurada para CORREIOS.' });
  });

  it('falha de autenticação: devolve success false com a mensagem do erro', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({
      username: 'user',
      password: 'pass',
      postCardNumber: '123',
      contractNumber: '456',
    });
    client.createLabel.mockRejectedValue(new Error('Correios /token/v1/autentica retornou HTTP 401 — verifique usuário/senha/cartão de postagem.'));

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/autentica/);
  });

  it('pré-postagem sem código de objeto: devolve success false', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({
      username: 'user',
      password: 'pass',
      postCardNumber: '123',
      contractNumber: '456',
    });
    client.createLabel.mockResolvedValue({});

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(result.success).toBe(false);
  });

  it('sucesso: devolve trackingCode + labelUrl (data URI do PDF)', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({
      username: 'user',
      password: 'pass',
      postCardNumber: '123',
      contractNumber: '456',
    });
    client.createLabel.mockResolvedValue({ trackingCode: 'OB123456789BR', labelUrl: 'data:application/pdf;base64,xxxx' });

    const result = await provider.generateLabel('tenant-1', buildInput());

    expect(client.createLabel).toHaveBeenCalledWith(
      { username: 'user', password: 'pass', postCardNumber: '123', contractNumber: '456' },
      expect.objectContaining({ toPostalCode: '04000-000', toName: 'Cliente Teste' }),
    );
    expect(result).toEqual({ success: true, trackingCode: 'OB123456789BR', labelUrl: 'data:application/pdf;base64,xxxx' });
  });

  // Quick Win 6 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 1.6/2) — avisoRecebimento/maoPropria propagados para o client,
  // default false quando o operador não marcou nenhum dos dois.
  it('propaga avisoRecebimento/maoPropria para o client quando informados', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({
      username: 'user',
      password: 'pass',
      postCardNumber: '123',
      contractNumber: '456',
    });
    client.createLabel.mockResolvedValue({ trackingCode: 'OB123456789BR' });

    await provider.generateLabel('tenant-1', { ...buildInput(), avisoRecebimento: true, maoPropria: true });

    expect(client.createLabel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ avisoRecebimento: true, maoPropria: true }),
    );
  });

  it('default avisoRecebimento/maoPropria para false quando não informados', async () => {
    const { provider, client, connections } = buildProvider();
    connections.requireCredential.mockResolvedValue({
      username: 'user',
      password: 'pass',
      postCardNumber: '123',
      contractNumber: '456',
    });
    client.createLabel.mockResolvedValue({ trackingCode: 'OB123456789BR' });

    await provider.generateLabel('tenant-1', buildInput());

    expect(client.createLabel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ avisoRecebimento: false, maoPropria: false }),
    );
  });
});
