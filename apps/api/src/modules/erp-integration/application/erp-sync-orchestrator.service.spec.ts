import { ErpSyncOrchestrator, motivoVisivelDeRejeicao } from './erp-sync-orchestrator.service';
import { InvalidOlistProductError } from '../domain/olist-product-normalizer';

// Regressão dos dois defeitos que derrubaram a integração do Olist em
// produção (diagnóstico de 09/08/2026: 135 execuções entre 31/07 e 09/08, as
// recentes todas em "API Bloqueada", ZERO produto no catálogo do tenant real):
//
//   1. o orquestrador re-tentava a busca inteira DEPOIS de o client já ter
//      esgotado suas 4 tentativas contra uma conta bloqueada por cota;
//   2. nada impedia dois syncs simultâneos do mesmo tenant dividirem a mesma
//      cota de 60 req/min — um sync completo leva 54 min, o scheduler acorda
//      a cada 30.
//
// Não é um spec completo do orquestrador: cobre o que esta correção mudou.

const ERRO_DE_COTA =
  'Olist produtos.pesquisa.php retornou erro: ' +
  '[{"erro":"API Bloqueada - Excedido o número de acessos a API, aguarde alguns minutos e tente novamente"}]';

const CONEXAO = {
  tenantId: 'tenant-1',
  apiTokenEnc: 'cifrado',
  isActive: true,
  lastSyncedAt: null,
};

function construirOrquestrador() {
  const connections = {
    findByTenant: jest.fn().mockResolvedValue(CONEXAO),
    findAllActive: jest.fn().mockResolvedValue([CONEXAO]),
    upsert: jest.fn(),
    deactivate: jest.fn(),
    markSynced: jest.fn().mockResolvedValue(undefined),
    markSyncedWithWarning: jest.fn().mockResolvedValue(undefined),
    markSyncFailed: jest.fn().mockResolvedValue(undefined),
  };
  const changeEvents = { findByExternalId: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
  const catalogWriter = {
    upsertFromExternalSource: jest.fn().mockResolvedValue({ changed: true, productId: 'prod-catalogo-1' }),
  };
  const syncLogs = {
    start: jest.fn().mockResolvedValue('log-1'),
    finish: jest.fn().mockResolvedValue(undefined),
  };
  const health = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(1),
  };
  const credentials = { decrypt: jest.fn().mockReturnValue('token-em-claro') };
  const client = {
    fetchAllActiveProductDetails: jest.fn(),
    obterProduto: jest.fn(),
  };
  const photoMirror = { mirrorAll: jest.fn().mockResolvedValue({ urls: [], houveFalha: false }) };
  // O produto importado é ANUNCIADO por evento (13/08/2026); quem classifica
  // é o Tax Intelligence, que escuta. Este arquivo verifica que o anúncio sai,
  // não o que o ouvinte faz com ele.
  const events = { emit: jest.fn() };
  // Só serve ao caminho do atalho (hash igual), onde o writer não é chamado e
  // o productId precisa ser resolvido pelo SKU.
  const catalogReader = {
    findBySku: jest.fn().mockResolvedValue({ productId: 'prod-catalogo-1', skuCode: 'SKU-1' }),
  };

  const orchestrator = new ErpSyncOrchestrator(
    connections as never,
    changeEvents as never,
    catalogWriter as never,
    syncLogs as never,
    health as never,
    credentials as never,
    client as never,
    photoMirror as never,
    events as never,
    catalogReader as never,
  );

  return { orchestrator, connections, syncLogs, health, client, events, catalogReader, changeEvents, catalogWriter };
}

describe('ErpSyncOrchestrator — bloqueio de cota do Olist', () => {
  it('NÃO re-tenta a busca quando a conta está bloqueada por cota', async () => {
    const { orchestrator, client } = construirOrquestrador();
    client.fetchAllActiveProductDetails.mockRejectedValue(new Error(ERRO_DE_COTA));

    const resultado = await orchestrator.syncTenant('tenant-1');

    // UMA chamada. Antes da correção eram 3 varreduras completas do catálogo
    // contra uma conta já suspensa, cada uma renovando o bloqueio.
    expect(client.fetchAllActiveProductDetails).toHaveBeenCalledTimes(1);
    expect(resultado.success).toBe(false);
    expect(resultado.error).toContain('API Bloqueada');
  });

  it('continua re-tentando erro que não é de cota', async () => {
    jest.useFakeTimers();
    try {
      const { orchestrator, client } = construirOrquestrador();
      client.fetchAllActiveProductDetails
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ details: [], failedCount: 0 });

      const promessa = orchestrator.syncTenant('tenant-1');
      await jest.advanceTimersByTimeAsync(2000); // primeiro backoff
      const resultado = await promessa;

      // A correção mira SÓ cota — falha transitória de rede continua com retry.
      expect(client.fetchAllActiveProductDetails).toHaveBeenCalledTimes(2);
      expect(resultado.success).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('motivoVisivelDeRejeicao', () => {
  it('passa inteira a mensagem de cadastro incompleto, que foi escrita para o lojista', () => {
    const erro = new InvalidOlistProductError('794327305', 'NCM ausente — preencha no cadastro do Olist.');

    const motivo = motivoVisivelDeRejeicao('Produto Olist 794327305', erro);

    expect(motivo).toBe(erro.message);
    expect(motivo).toContain('preencha no cadastro do Olist');
  });

  it('não repassa mensagem crua de infraestrutura para a tela', () => {
    // Forma real de um P2002 do Prisma: caminho absoluto do arquivo, nome do
    // model e da constraint. Isso ia parar em lastSyncError e era renderizado
    // no card de Integrações.
    const erro = new Error(
      'Invalid `prisma.product.create()` invocation in\n' +
        'D:\\Projeto SAAS\\precifica-saas\\apps\\api\\src\\modules\\catalog\\infrastructure\\prisma-product.repository.ts:42\n' +
        'Unique constraint failed on the fields: (`tenantId`,`skuCode`)',
    );

    const motivo = motivoVisivelDeRejeicao('Produto Olist 794327305', erro);

    expect(motivo).not.toContain('prisma.product.create');
    expect(motivo).not.toContain('prisma-product.repository.ts');
    expect(motivo).not.toContain('tenantId');
    expect(motivo).not.toContain('D:\\');
    // Ainda diz QUAL produto e para onde olhar.
    expect(motivo).toContain('794327305');
    expect(motivo).toContain('log do servidor');
  });
});

describe('ErpSyncOrchestrator — anúncio do produto importado', () => {
  // REGRESSÃO (14/08/2026). O evento nasceu só no caminho de ESCRITA, depois
  // do atalho de "hash igual, pula". Resultado em produção: 249 produtos
  // importados e estáveis, ZERO classificados — nenhum deles mudava no ERP, e
  // portanto nenhum chegava ao anúncio.
  //
  // Classificação fiscal não depende de o dado ter mudado: depende do NCM, da
  // UF e da norma vigente.
  const PRODUTO_OLIST = {
    id: '1',
    codigo: 'SKU-1',
    nome: 'Batom',
    ncm: '33041000',
    peso_liquido: '0.076',
    comprimentoEmbalagem: '16',
    larguraEmbalagem: '11',
    alturaEmbalagem: '3',
  };

  it('anuncia o produto MESMO quando nada mudou no ERP', async () => {
    const { orchestrator, client, events, catalogReader, changeEvents } = construirOrquestrador();
    client.fetchAllActiveProductDetails.mockResolvedValue({
      details: [{ produto: PRODUTO_OLIST }],
      failedCount: 0,
    });

    // PRIMEIRA passada: produto novo, caminho de escrita.
    await orchestrator.syncTenant('tenant-1');
    const hashGravado = changeEvents.upsert.mock.calls[0][0].contentHash;
    expect(events.emit).toHaveBeenCalledTimes(1);

    // SEGUNDA passada: mesmo dado, hash idêntico — o atalho é tomado e o
    // writer NÃO é chamado. Antes da correção, o anúncio morria aqui.
    events.emit.mockClear();
    catalogReader.findBySku.mockClear();
    changeEvents.findByExternalId.mockResolvedValue({ contentHash: hashGravado });

    await orchestrator.syncTenant('tenant-1');

    // O productId vem do catálogo, já que o writer não rodou nesta passada.
    expect(catalogReader.findBySku).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'erp.product.imported',
      expect.objectContaining({ tenantId: 'tenant-1', productId: 'prod-catalogo-1', ncm: '33041000' }),
    );
  });
});

describe('ErpSyncOrchestrator — sync simultâneo do mesmo tenant', () => {
  it('recusa a segunda execução enquanto a primeira está em andamento', async () => {
    const { orchestrator, syncLogs, client } = construirOrquestrador();

    // Segura a primeira execução aberta para que a segunda chegue durante ela.
    let liberar!: (v: { details: never[]; failedCount: number }) => void;
    client.fetchAllActiveProductDetails.mockReturnValue(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );

    const primeira = orchestrator.syncTenant('tenant-1');
    // Deixa a primeira avançar até ficar parada no fetch controlado acima —
    // sem isto ela ainda está nos awaits anteriores e o teste mediria o
    // momento errado, não a trava.
    await new Promise((resolve) => setImmediate(resolve));

    const segunda = await orchestrator.syncTenant('tenant-1');

    expect(segunda.success).toBe(false);
    expect(segunda.error).toContain('em andamento');
    // A recusa não abre log nem consome cota: uma execução, um log.
    expect(syncLogs.start).toHaveBeenCalledTimes(1);
    expect(client.fetchAllActiveProductDetails).toHaveBeenCalledTimes(1);

    liberar({ details: [], failedCount: 0 });
    await primeira;
  });

  it('libera a trava ao final, inclusive quando o sync falha', async () => {
    const { orchestrator, client } = construirOrquestrador();
    client.fetchAllActiveProductDetails.mockRejectedValueOnce(new Error(ERRO_DE_COTA));

    const primeira = await orchestrator.syncTenant('tenant-1');
    expect(primeira.success).toBe(false);

    // Trava presa após falha deixaria o tenant sem sync até o próximo restart
    // do processo — pior que a corrida que a trava evita.
    client.fetchAllActiveProductDetails.mockResolvedValueOnce({ details: [], failedCount: 0 });
    const segunda = await orchestrator.syncTenant('tenant-1');
    expect(segunda.success).toBe(true);
  });
});
