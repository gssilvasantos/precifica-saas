import {
  CategoriaExistente,
  ProdutoComCategoriaDeOrigem,
  planejarImportacaoDeCategorias,
} from './erp-category-import-plan';

const produto = (over: Partial<ProdutoComCategoriaDeOrigem> = {}): ProdutoComCategoriaDeOrigem => ({
  productId: 'p1',
  skuCode: 'SKU-1',
  erpCategoryPath: 'ROSTO > BASE > BASE LÍQUIDA',
  categoryId: null,
  ...over,
});

describe('planejarImportacaoDeCategorias', () => {
  it('cria todos os níveis do caminho, não só a folha', () => {
    const plano = planejarImportacaoDeCategorias([produto()], []);

    expect(plano.categoriasACriar.map((c) => c.caminho)).toEqual([
      ['ROSTO'],
      ['ROSTO', 'BASE'],
      ['ROSTO', 'BASE', 'BASE LÍQUIDA'],
    ]);
  });

  // Ordenado por profundidade para que o pai exista quando o filho for criado.
  it('ordena da raiz para as folhas', () => {
    const plano = planejarImportacaoDeCategorias(
      [produto({ erpCategoryPath: 'A > B > C' }), produto({ productId: 'p2', erpCategoryPath: 'X' })],
      [],
    );

    const profundidades = plano.categoriasACriar.map((c) => c.caminho.length);
    expect(profundidades).toEqual([...profundidades].sort((a, b) => a - b));
  });

  it('não recria categoria que já existe', () => {
    const existentes: CategoriaExistente[] = [
      { id: 'c1', name: 'ROSTO', parentCategoryId: null },
      { id: 'c2', name: 'BASE', parentCategoryId: 'c1' },
    ];

    const plano = planejarImportacaoDeCategorias([produto()], existentes);

    expect(plano.categoriasACriar.map((c) => c.name)).toEqual(['BASE LÍQUIDA']);
  });

  // 'Rosto' e 'ROSTO' são a mesma categoria — sem isso a importação criaria
  // irmãs duplicadas que só diferem por caixa.
  it('compara caminhos ignorando maiúsculas e minúsculas', () => {
    const existentes: CategoriaExistente[] = [{ id: 'c1', name: 'Rosto', parentCategoryId: null }];
    const plano = planejarImportacaoDeCategorias([produto({ erpCategoryPath: 'ROSTO > BASE' })], existentes);

    expect(plano.categoriasACriar.map((c) => c.name)).toEqual(['BASE']);
  });

  it('deduplica caminhos repetidos entre produtos', () => {
    const plano = planejarImportacaoDeCategorias(
      [produto(), produto({ productId: 'p2', skuCode: 'SKU-2' }), produto({ productId: 'p3', skuCode: 'SKU-3' })],
      [],
    );

    expect(plano.categoriasACriar).toHaveLength(3);
    expect(plano.vinculos).toHaveLength(3);
  });

  describe('o que NÃO é tocado', () => {
    // A migração não desfaz decisão do usuário.
    it('não revincula produto que já tem categoria no Kyneti', () => {
      const plano = planejarImportacaoDeCategorias([produto({ categoryId: 'ja-tem' })], []);

      expect(plano.vinculos).toHaveLength(0);
      expect(plano.produtosJaClassificados).toBe(1);
      // A categoria ainda é criada: a árvore vem completa mesmo que este
      // produto específico não seja revinculado.
      expect(plano.categoriasACriar.length).toBeGreaterThan(0);
    });

    it('conta produto sem categoria no ERP em vez de ignorar em silêncio', () => {
      const plano = planejarImportacaoDeCategorias(
        [produto({ erpCategoryPath: null }), produto({ productId: 'p2', erpCategoryPath: '  ' })],
        [],
      );

      expect(plano.produtosSemCategoriaNoErp).toBe(2);
      expect(plano.categoriasACriar).toHaveLength(0);
    });
  });

  describe('formatos de caminho', () => {
    it('aceita separador com um ou dois sinais de maior', () => {
      const comUm = planejarImportacaoDeCategorias([produto({ erpCategoryPath: 'A > B' })], []);
      const comDois = planejarImportacaoDeCategorias([produto({ erpCategoryPath: 'A >> B' })], []);

      expect(comUm.categoriasACriar.map((c) => c.name)).toEqual(['A', 'B']);
      expect(comDois.categoriasACriar.map((c) => c.name)).toEqual(['A', 'B']);
    });

    // Um nó sem nome quebraria a árvore.
    it('descarta nível vazio no meio do caminho', () => {
      const plano = planejarImportacaoDeCategorias([produto({ erpCategoryPath: 'ROSTO >  > BASE' })], []);
      expect(plano.categoriasACriar.map((c) => c.name)).toEqual(['ROSTO', 'BASE']);
    });

    it('aceita categoria de nível único', () => {
      const plano = planejarImportacaoDeCategorias([produto({ erpCategoryPath: 'PERFUMARIA' })], []);

      expect(plano.categoriasACriar).toEqual([
        { caminho: ['PERFUMARIA'], name: 'PERFUMARIA', caminhoDoPai: [] },
      ]);
    });
  });

  // Árvore corrompida não pode travar o servidor.
  it('não entra em laço infinito com ciclo na árvore existente', () => {
    const ciclo: CategoriaExistente[] = [
      { id: 'c1', name: 'A', parentCategoryId: 'c2' },
      { id: 'c2', name: 'B', parentCategoryId: 'c1' },
    ];

    expect(() => planejarImportacaoDeCategorias([produto()], ciclo)).not.toThrow();
  });
});
