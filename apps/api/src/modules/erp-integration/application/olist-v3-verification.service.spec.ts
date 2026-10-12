import { OlistV3VerificationService, MAX_VERIFY_SKUS } from './olist-v3-verification.service';
import { OlistV3ConnectionService } from './olist-v3-connection.service';
import { OlistV3ApiClient } from '../infrastructure/olist/olist-v3-api.client';

const RL = { limit: 60, remaining: 50, resetSeconds: 5 };

function build(overrides: Partial<Record<'listarProdutos' | 'obterProduto', jest.Mock>> = {}) {
  const connection = { getValidAccessToken: jest.fn().mockResolvedValue('tok') };
  const client = {
    listarProdutos: overrides.listarProdutos ?? jest.fn(),
    obterProduto: overrides.obterProduto ?? jest.fn(),
  };
  const service = new OlistV3VerificationService(
    connection as unknown as OlistV3ConnectionService,
    client as unknown as OlistV3ApiClient,
  );
  return { service, connection, client };
}

describe('OlistV3VerificationService', () => {
  it('propaga erro de token sem chamar o Olist', async () => {
    const { service, connection, client } = build();
    connection.getValidAccessToken.mockRejectedValue(new Error('nao conectado'));
    await expect(service.verify('t1', ['A'])).rejects.toThrow('nao conectado');
    expect(client.listarProdutos).not.toHaveBeenCalled();
  });

  it('usa o token do tenant informado', async () => {
    const listarProdutos = jest.fn().mockResolvedValue({ data: { itens: [] }, rateLimit: RL });
    const { service, connection } = build({ listarProdutos });
    await service.verify('tenant-a', ['X1']);
    expect(connection.getValidAccessToken).toHaveBeenCalledWith('tenant-a');
  });

  it('SKU não encontrado: found=false e só 2 chamadas (sonda + lista)', async () => {
    const listarProdutos = jest.fn().mockResolvedValue({ data: { itens: [], paginacao: { total: 0 } }, rateLimit: RL });
    const obterProduto = jest.fn();
    const { service } = build({ listarProdutos, obterProduto });
    const result = await service.verify('t', ['NAOEXISTE']);
    expect(result.skus[0]).toMatchObject({ sku: 'NAOEXISTE', found: false, produto: null, error: null });
    expect(result.callsMade).toBe(2);
    expect(obterProduto).not.toHaveBeenCalled();
    expect(result.rateLimit).toEqual(RL);
  });

  it('SKU encontrado busca o detalhe pelo id', async () => {
    const listarProdutos = jest
      .fn()
      .mockResolvedValueOnce({ data: { itens: [], paginacao: { total: 4 } }, rateLimit: RL })
      .mockResolvedValueOnce({ data: { itens: [{ id: 77, sku: 'rm0001-1', tipoVariacao: 'V' }] }, rateLimit: RL });
    const obterProduto = jest.fn().mockResolvedValue({ data: { id: 77, sku: 'RM0001-1' }, rateLimit: RL });
    const { service } = build({ listarProdutos, obterProduto });
    const result = await service.verify('t', ['RM0001-1']);
    expect(obterProduto).toHaveBeenCalledWith('tok', '77');
    expect(result.skus[0].found).toBe(true);
    expect(result.skus[0].tipoVariacao).toBe('V');
    expect(result.callsMade).toBe(3);
  });

  it('erro numa SKU não derruba as outras nem a sonda incremental', async () => {
    const listarProdutos = jest
      .fn()
      .mockRejectedValueOnce(new Error('sonda falhou'))
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ data: { itens: [] }, rateLimit: RL });
    const { service } = build({ listarProdutos });
    const result = await service.verify('t', ['A', 'B']);
    expect(result.incrementalProbe.error).toBe('sonda falhou');
    expect(result.skus[0].error).toBe('HTTP 500');
    expect(result.skus[1]).toMatchObject({ found: false, error: null });
  });

  it('respeita o teto de SKUs e de chamadas (7)', async () => {
    const listarProdutos = jest.fn().mockImplementation(async (_t: string, p: { codigo?: string }) => ({
      data: { itens: p.codigo ? [{ id: 1, sku: p.codigo, tipoVariacao: 'N' }] : [] },
      rateLimit: RL,
    }));
    const obterProduto = jest.fn().mockResolvedValue({ data: {}, rateLimit: RL });
    const { service } = build({ listarProdutos, obterProduto });
    const result = await service.verify('t', ['A', 'B', 'C', 'D', 'E']);
    expect(MAX_VERIFY_SKUS).toBe(3);
    expect(result.skus).toHaveLength(3);
    expect(result.callsMade).toBe(7);
  });

  it('a sonda incremental pede janela de 7 dias, só ativos', async () => {
    const listarProdutos = jest.fn().mockResolvedValue({ data: { itens: [] }, rateLimit: RL });
    const { service } = build({ listarProdutos });
    const result = await service.verify('t', ['A']);
    const probeArgs = listarProdutos.mock.calls[0][1];
    expect(probeArgs.situacao).toBe('A');
    expect(probeArgs.dataAlteracao).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(result.incrementalProbe.windowDays).toBe(7);
  });
});
