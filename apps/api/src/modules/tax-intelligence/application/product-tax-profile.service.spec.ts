import { BadRequestException } from '@nestjs/common';
import { ProductTaxProfileService } from './product-tax-profile.service';
import { NovoPerfilDeProduto, ProductTaxProfileRecord } from './ports/tax-repositories.port';

const TENANT = 'tenant-1';
const PRODUTO = 'produto-1';

function registro(over: Partial<ProductTaxProfileRecord> = {}): ProductTaxProfileRecord {
  return {
    id: 'perfil-1',
    productId: PRODUTO,
    uf: 'SP',
    icmsSt: true,
    monofasico: false,
    ncm: '33049990',
    fonte: 'PORTARIA_SRE_94_2025',
    vigenciaInicio: new Date('2026-01-01T00:00:00Z'),
    vigenciaFim: null,
    ...over,
  };
}

function construir(vigente: ProductTaxProfileRecord | null = null) {
  const recebido: NovoPerfilDeProduto[] = [];
  const repo = {
    findVigente: jest.fn().mockResolvedValue(vigente),
    listarPorProduto: jest.fn().mockResolvedValue([]),
    abrirNovaVigencia: jest.fn(async (input: NovoPerfilDeProduto) => {
      recebido.push(input);
      return registro({ uf: input.uf, ncm: input.ncm, vigenciaInicio: input.vigenciaInicio });
    }),
  };
  return { service: new ProductTaxProfileService(repo as never), repo, recebido };
}

const VALIDO = {
  productId: PRODUTO,
  uf: 'SP',
  icmsSt: true,
  monofasico: false,
  ncm: '3304.99.90',
  fonte: 'PORTARIA_SRE_94_2025',
  vigenciaInicio: new Date('2026-04-01T00:00:00Z'),
};

async function capturarBadRequest(promessa: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof BadRequestException) return erro;
    throw erro;
  }
  throw new Error('Esperava BadRequestException, mas a operação foi concluída com sucesso.');
}

describe('ProductTaxProfileService', () => {
  it('classifica um produto e normaliza UF e NCM', async () => {
    const { service, recebido } = construir(null);

    await service.classificar(TENANT, { ...VALIDO, uf: ' sp ' });

    expect(recebido[0].uf).toBe('SP');
    // Pontuação removida — o schema guarda só os 8 dígitos.
    expect(recebido[0].ncm).toBe('33049990');
    expect(recebido[0].tenantId).toBe(TENANT);
  });

  it('aceita NCM ausente', async () => {
    const { service, recebido } = construir(null);

    await service.classificar(TENANT, { ...VALIDO, ncm: null });

    expect(recebido[0].ncm).toBeNull();
  });

  it('recusa NCM truncado — classificaria o produto errado', async () => {
    const { service, repo } = construir(null);

    const erro = await capturarBadRequest(service.classificar(TENANT, { ...VALIDO, ncm: '3304' }));

    expect((erro.getResponse() as { code: string }).code).toBe('PERFIL_DE_PRODUTO_INVALIDO');
    expect(repo.abrirNovaVigencia).not.toHaveBeenCalled();
  });

  it('recusa fonte fora do catálogo de normas', async () => {
    // Fonte livre viraria campo de texto que ninguém preenche direito; a
    // pergunta "por que este SKU mudou de alíquota?" precisa apontar a norma.
    const { service } = construir(null);

    const erro = await capturarBadRequest(service.classificar(TENANT, { ...VALIDO, fonte: 'porque sim' }));

    const problemas = (erro.getResponse() as { problemas: { campo: string }[] }).problemas;
    expect(problemas.map((p) => p.campo)).toContain('fonte');
  });

  it('recusa UF inválida', async () => {
    const { service } = construir(null);

    const erro = await capturarBadRequest(service.classificar(TENANT, { ...VALIDO, uf: 'XX' }));

    expect((erro.getResponse() as { problemas: { campo: string }[] }).problemas.map((p) => p.campo)).toContain('uf');
  });

  it('recusa vigência retroativa sobre a classificação já vigente naquela UF', async () => {
    const { service, repo } = construir(registro({ uf: 'SP', vigenciaInicio: new Date('2026-04-01T00:00:00Z') }));

    const erro = await capturarBadRequest(
      service.classificar(TENANT, { ...VALIDO, vigenciaInicio: new Date('2026-02-01T00:00:00Z') }),
    );

    expect((erro.getResponse() as { code: string }).code).toBe('VIGENCIA_RETROATIVA');
    expect(repo.abrirNovaVigencia).not.toHaveBeenCalled();
  });

  it('consulta a vigência da UF sendo classificada, não de outra', async () => {
    // ST é regime ESTADUAL: classificar em PR não pode ser barrado por uma
    // vigência de SP, nem encerrá-la.
    const { service, repo } = construir(null);

    await service.classificar(TENANT, { ...VALIDO, uf: 'PR' });

    expect(repo.findVigente).toHaveBeenCalledWith(TENANT, PRODUTO, 'PR', expect.any(Date));
    expect(repo.abrirNovaVigencia).toHaveBeenCalled();
  });

  it('permite marcar ST e monofásico ao mesmo tempo', async () => {
    // Cosmético em ST no estado E monofásico de PIS/Cofins é o caso real que
    // motivou a segregação por produto — as duas parcelas saem da partilha.
    const { service, recebido } = construir(null);

    await service.classificar(TENANT, { ...VALIDO, icmsSt: true, monofasico: true });

    expect(recebido[0].icmsSt).toBe(true);
    expect(recebido[0].monofasico).toBe(true);
  });
});
