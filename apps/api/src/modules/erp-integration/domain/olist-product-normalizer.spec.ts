import { InvalidOlistProductError, extractVariationRefs, normalizeOlistProduct } from './olist-product-normalizer';

// Cadastro mínimo válido: peso e dimensões preenchidos. Ausentes NÃO rejeitam
// mais o produto (03/08/2026) — ele entra marcado com
// hasCompleteDimensions: false. Ver os casos "sem dimensões" mais abaixo.
const PRODUTO_OLIST = {
  id: '778899',
  codigo: 'BAT-VM-4G',
  nome: 'Batom matte vermelho 4g',
  preco_custo: '12,50',
  preco: '29,90',
  estoque_atual: '40',
  peso_liquido: '0,012',
  peso_bruto: '0,030',
  // Nomes REAIS do retorno de produto.obter.php. Até 11/08/2026 este fixture
  // usava `comprimento`/`largura`/`altura`, que não existem na API — era por
  // isso que a suíte ficava verde enquanto produção lia zero em 100% dos SKUs.
  comprimentoEmbalagem: '9',
  larguraEmbalagem: '2',
  alturaEmbalagem: '2',
};

describe('normalizeOlistProduct', () => {
  describe('campos fiscais', () => {
    it('extrai NCM, CEST, GTIN e origem', () => {
      const p = normalizeOlistProduct({
        produto: { ...PRODUTO_OLIST, ncm: '3304.99.90', cest: '20.063.00', gtin: '7891234567890', origem: '0' },
      });

      expect(p.ncm).toBe('3304.99.90');
      expect(p.cest).toBe('20.063.00');
      expect(p.gtin).toBe('7891234567890');
      expect(p.fiscalOriginCode).toBe(0);
    });

    // Cadastro incompleto no Olist é comum e NÃO deve rejeitar o produto —
    // diferente de peso e dimensões. O produto entra sem NCM e aparece
    // marcado no catálogo, que é onde o usuário vai procurar o que falta.
    it('aceita produto sem campo fiscal nenhum', () => {
      const p = normalizeOlistProduct({ produto: PRODUTO_OLIST });

      expect(p.ncm).toBeNull();
      expect(p.cest).toBeNull();
      expect(p.gtin).toBeNull();
      expect(p.fiscalOriginCode).toBeNull();
      expect(p.skuCode).toBe('BAT-VM-4G');
    });

    // String vazia gravada como se fosse NCM esconderia o produto do filtro
    // de "sem NCM".
    it('trata string vazia e espaço em branco como ausência', () => {
      const p = normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, ncm: '', cest: '   ', gtin: '' } });

      expect(p.ncm).toBeNull();
      expect(p.cest).toBeNull();
      expect(p.gtin).toBeNull();
    });

    it('aceita `ean` como alternativa a `gtin`', () => {
      const p = normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, ean: '7899999999999' } });
      expect(p.gtin).toBe('7899999999999');
    });

    // Origem 0 (nacional) é o valor mais comum e é falsy — não pode virar null.
    it('preserva origem zero', () => {
      expect(normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, origem: 0 } }).fiscalOriginCode).toBe(0);
    });

    it('remove espaços em volta do valor', () => {
      expect(normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, ncm: ' 3304.99.90 ' } }).ncm).toBe('3304.99.90');
    });
  });

  // As variações não aparecem em produtos.pesquisa.php — vêm dentro do
  // detalhe do pai. É o que explica os "340 produtos" da tela do ERP contra
  // as ~937 SKUs reais.
  describe('extractVariationRefs', () => {
    it('extrai id, SKU e atributos de cada variação', () => {
      const refs = extractVariationRefs({
        produto: {
          ...PRODUTO_OLIST,
          variacoes: [
            { variacao: { id: '901', codigo: 'RM0298-1', grade: { Cor: 'Cacau' } } },
            { variacao: { id: '902', codigo: 'RM0298-2', grade: { Cor: 'Nude' } } },
          ],
        },
      });

      expect(refs).toEqual([
        { externalId: '901', skuCode: 'RM0298-1', variantAttributes: { Cor: 'Cacau' } },
        { externalId: '902', skuCode: 'RM0298-2', variantAttributes: { Cor: 'Nude' } },
      ]);
    });

    it('devolve vazio para produto simples', () => {
      expect(extractVariationRefs({ produto: PRODUTO_OLIST })).toEqual([]);
    });

    // A grade chega em duas formas conhecidas na V2. Errar a forma produziria
    // variações sem atributo nenhum, indistinguíveis entre si na tela.
    it('aceita grade como lista de pares chave/valor', () => {
      const refs = extractVariationRefs({
        produto: {
          ...PRODUTO_OLIST,
          variacoes: [
            {
              variacao: {
                id: '901',
                codigo: 'RM0298-1',
                grade: [
                  { chave: 'Cor', valor: 'Cacau' },
                  { chave: 'Volume', valor: '30ml' },
                ],
              },
            },
          ],
        },
      });

      expect(refs[0].variantAttributes).toEqual({ Cor: 'Cacau', Volume: '30ml' });
    });

    it('aceita variação sem envelope `variacao`', () => {
      const refs = extractVariationRefs({
        produto: { ...PRODUTO_OLIST, variacoes: [{ id: '901', codigo: 'RM0298-1', grade: { Cor: 'Cacau' } }] },
      });
      expect(refs[0].externalId).toBe('901');
    });

    // Variação sem código não tem como ser vinculada a anúncio nenhum —
    // descartar é melhor que criar um produto sem SKU.
    it('descarta variação sem id ou sem código', () => {
      const refs = extractVariationRefs({
        produto: {
          ...PRODUTO_OLIST,
          variacoes: [
            { variacao: { id: '901', codigo: '' } },
            { variacao: { codigo: 'SEM-ID' } },
            { variacao: { id: '903', codigo: 'OK-1' } },
          ],
        },
      });

      expect(refs).toHaveLength(1);
      expect(refs[0].skuCode).toBe('OK-1');
    });

    it('não quebra com variacoes ausente ou em formato inesperado', () => {
      expect(extractVariationRefs({ produto: { ...PRODUTO_OLIST, variacoes: null } })).toEqual([]);
      expect(extractVariationRefs({ produto: { ...PRODUTO_OLIST, variacoes: 'nenhuma' } })).toEqual([]);
      expect(extractVariationRefs(null)).toEqual([]);
    });
  });

  // A categoria do Kyneti é organizada pelo usuário — o sync só REGISTRA o
  // caminho de origem. Virar árvore estruturada é ação separada de migração.
  describe('categoria de origem', () => {
    it('quebra o caminho em níveis', () => {
      const p = normalizeOlistProduct({
        produto: { ...PRODUTO_OLIST, categoria: 'ROSTO > BASE > BASE LÍQUIDA' },
      });
      expect(p.categoryPath).toEqual(['ROSTO', 'BASE', 'BASE LÍQUIDA']);
    });

    it('aceita separador com dois sinais de maior', () => {
      expect(
        normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, categoria: 'ROSTO >> BASE' } }).categoryPath,
      ).toEqual(['ROSTO', 'BASE']);
    });

    it('aceita categoria como objeto', () => {
      const p = normalizeOlistProduct({
        produto: { ...PRODUTO_OLIST, categoria: { id: '7', caminhoCompleto: 'ROSTO > BASE' } },
      });
      expect(p.categoryPath).toEqual(['ROSTO', 'BASE']);
    });

    it('devolve vazio quando o produto não tem categoria no ERP', () => {
      expect(normalizeOlistProduct({ produto: PRODUTO_OLIST }).categoryPath).toEqual([]);
      expect(normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, categoria: '' } }).categoryPath).toEqual([]);
    });
  });

  // O primeiro sync real contra a conta rejeitou 1.803 de 1.804 SKUs: o Olist
  // tem o peso preenchido e as dimensões zeradas. Descartar o produto inteiro
  // por isso joga fora custo, estoque, NCM, categoria e SKU.
  describe('cadastro sem dimensões — importa marcado, não rejeita', () => {
    const semDimensoes = {
      ...PRODUTO_OLIST,
      comprimentoEmbalagem: '0',
      larguraEmbalagem: '0',
      alturaEmbalagem: '0',
    };

    it('não rejeita, e preserva todo o resto do cadastro', () => {
      const p = normalizeOlistProduct({ produto: { ...semDimensoes, ncm: '3304.99.90' } });

      expect(p.hasCompleteDimensions).toBe(false);
      expect(p.skuCode).toBe('BAT-VM-4G');
      expect(p.costPrice).toBe(12.5);
      expect(p.stockQuantity).toBe(40);
      expect(p.ncm).toBe('3304.99.90');
    });

    it('marca como completo quando peso e as três medidas estão preenchidos', () => {
      expect(normalizeOlistProduct({ produto: PRODUTO_OLIST }).hasCompleteDimensions).toBe(true);
    });

    it.each([
      ['comprimento', { comprimentoEmbalagem: '0' }],
      ['largura', { larguraEmbalagem: '0' }],
      ['altura', { alturaEmbalagem: '0' }],
      ['peso', { peso_liquido: '0' }],
    ])('marca como incompleto quando falta %s', (_campo, override) => {
      expect(normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, ...override } }).hasCompleteDimensions).toBe(
        false,
      );
    });
  });

  // REGRESSÃO DA CAUSA RAIZ (11/08/2026).
  //
  // O sync de 03/08 rejeitou 1.803 de 1.804 SKUs com "peso=0.076, L=0, W=0,
  // H=0". Não era cadastro incompleto: o normalizador lia `comprimento`,
  // `largura` e `altura`, que não existem em produto.obter.php. O peso vinha
  // certo porque `peso_liquido` está em snake_case e era lido corretamente.
  describe('nomes de campo de dimensão da API real', () => {
    const SEM_MEDIDAS = (() => {
      const base: Record<string, unknown> = { ...PRODUTO_OLIST };
      delete base.comprimentoEmbalagem;
      delete base.larguraEmbalagem;
      delete base.alturaEmbalagem;
      return base;
    })();

    it('lê a grafia camelCase de produto.obter.php', () => {
      const p = normalizeOlistProduct({
        produto: { ...SEM_MEDIDAS, comprimentoEmbalagem: '9', larguraEmbalagem: '2', alturaEmbalagem: '2' },
      });

      expect([p.lengthCm, p.widthCm, p.heightCm]).toEqual([9, 2, 2]);
      expect(p.hasCompleteDimensions).toBe(true);
    });

    it('lê a grafia snake_case documentada em produtos.incluir', () => {
      const p = normalizeOlistProduct({
        produto: { ...SEM_MEDIDAS, comprimento_embalagem: '9', largura_embalagem: '2', altura_embalagem: '2' },
      });

      expect([p.lengthCm, p.widthCm, p.heightCm]).toEqual([9, 2, 2]);
      expect(p.hasCompleteDimensions).toBe(true);
    });

    it('ainda lê o nome isolado, como último recurso', () => {
      const p = normalizeOlistProduct({
        produto: { ...SEM_MEDIDAS, comprimento: '9', largura: '2', altura: '2' },
      });

      expect([p.lengthCm, p.widthCm, p.heightCm]).toEqual([9, 2, 2]);
    });

    it('medida cadastrada como ZERO fica zero, não procura outro apelido', () => {
      // A ausência do campo faz cair para o próximo nome; um zero explícito é
      // um valor real do ERP e precisa ser respeitado.
      const p = normalizeOlistProduct({
        produto: { ...SEM_MEDIDAS, comprimentoEmbalagem: '0', comprimento: '9', larguraEmbalagem: '2', alturaEmbalagem: '2' },
      });

      expect(p.lengthCm).toBe(0);
      expect(p.hasCompleteDimensions).toBe(false);
    });

    it('reproduz o payload que rejeitou 1.803 SKUs — agora com as medidas certas', () => {
      // Forma exata do produto 794327305 no log de 03/08: peso preenchido,
      // medidas presentes sob o nome REAL. Com o mapeamento corrigido, o
      // produto entra completo — nunca esteve incompleto.
      const p = normalizeOlistProduct({
        produto: {
          ...SEM_MEDIDAS,
          peso_liquido: '0.076',
          comprimentoEmbalagem: '16',
          larguraEmbalagem: '11',
          alturaEmbalagem: '3',
        },
      });

      expect(p.weightKg).toBe(0.076);
      expect([p.lengthCm, p.widthCm, p.heightCm]).toEqual([16, 11, 3]);
      expect(p.hasCompleteDimensions).toBe(true);
    });
  });

  // O que continua rejeitando: só o que torna o registro sem sentido.
  describe('rejeições que continuam valendo', () => {
    it('rejeita produto sem SKU — não há como vincular a anúncio nenhum', () => {
      expect(() => normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, codigo: '' } })).toThrow(
        InvalidOlistProductError,
      );
    });

    it('rejeita produto sem id e sem nome', () => {
      expect(() => normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, id: '' } })).toThrow(
        InvalidOlistProductError,
      );
      expect(() => normalizeOlistProduct({ produto: { ...PRODUTO_OLIST, nome: '' } })).toThrow(
        InvalidOlistProductError,
      );
    });
  });
});
