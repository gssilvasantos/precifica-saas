import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import {
  PRODUCT_CATEGORY_REPOSITORY,
  ProductCategoryRepository,
} from './ports/product-category-repository.port';
import {
  PlanoDeImportacao,
  SEPARADOR_DE_NIVEL,
  planejarImportacaoDeCategorias,
} from '../domain/erp-category-import-plan';

export interface ResultadoDaImportacao {
  categoriasCriadas: number;
  produtosVinculados: number;
  produtosSemCategoriaNoErp: number;
  produtosJaClassificados: number;
}

// Importa a árvore de categorias do ERP para o Kyneti — sob demanda, nunca
// automaticamente.
//
// A categoria do Kyneti é do usuário: ele organiza como quiser, e a estrutura
// do Olist é uma organização particular dele, não uma verdade a replicar. O
// sync apenas registra o caminho de origem em `Product.internalCategory`
// (texto livre); esta ação existe como conveniência de MIGRAÇÃO, para quem
// está saindo de um sistema e não quer recadastrar a árvore à mão.
//
// Por isso o par preview/apply: mesma disciplina do Safety Lock usada no resto
// da plataforma — o usuário vê exatamente o que vai acontecer antes de
// acontecer, e nada é escrito sem um segundo comando explícito.
@Injectable()
export class ErpCategoryImportService {
  private readonly logger = new Logger(ErpCategoryImportService.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_CATEGORY_REPOSITORY) private readonly categories: ProductCategoryRepository,
  ) {}

  async preview(tenantId: string): Promise<PlanoDeImportacao> {
    const [produtos, categorias] = await Promise.all([
      this.products.findAllActive(tenantId),
      this.categories.findAllByTenant(tenantId),
    ]);

    return planejarImportacaoDeCategorias(
      produtos.map((p) => ({
        productId: p.id,
        skuCode: p.skuCode,
        erpCategoryPath: p.internalCategory,
        categoryId: p.categoryId,
      })),
      categorias.map((c) => ({ id: c.id, name: c.name, parentCategoryId: c.parentCategoryId ?? null })),
    );
  }

  async apply(tenantId: string): Promise<ResultadoDaImportacao> {
    // Replaneja em vez de receber o plano do cliente: entre a prévia e a
    // confirmação o catálogo pode ter mudado, e aplicar um plano velho criaria
    // categoria duplicada ou vincularia produto que já foi classificado.
    const plano = await this.preview(tenantId);

    // Caminho completo -> id, alimentado à medida que os nós são criados. As
    // categorias vêm ordenadas por profundidade, então o pai sempre já está
    // aqui quando o filho é criado.
    const idPorCaminho = new Map<string, string>();
    const chave = (caminho: string[]) => caminho.map((n) => n.trim().toLowerCase()).join(SEPARADOR_DE_NIVEL);

    // Semeia com o que já existe, para que um nível novo pendurado numa
    // categoria antiga encontre o pai.
    const existentes = await this.categories.findAllByTenant(tenantId);
    const porId = new Map(existentes.map((c) => [c.id, c]));
    for (const categoria of existentes) {
      const caminho: string[] = [];
      let atual = categoria as { id: string; name: string; parentCategoryId?: string | null } | undefined;
      const visitados = new Set<string>();
      while (atual && !visitados.has(atual.id)) {
        visitados.add(atual.id);
        caminho.unshift(atual.name);
        atual = atual.parentCategoryId ? porId.get(atual.parentCategoryId) : undefined;
      }
      idPorCaminho.set(chave(caminho), categoria.id);
    }

    let categoriasCriadas = 0;
    for (const nova of plano.categoriasACriar) {
      const parentCategoryId = nova.caminhoDoPai.length > 0 ? (idPorCaminho.get(chave(nova.caminhoDoPai)) ?? null) : null;
      const criada = await this.categories.create({ tenantId, name: nova.name, parentCategoryId });
      idPorCaminho.set(chave(nova.caminho), criada.id);
      categoriasCriadas++;
    }

    let produtosVinculados = 0;
    for (const vinculo of plano.vinculos) {
      const categoryId = idPorCaminho.get(chave(vinculo.caminho));
      if (!categoryId) {
        // Não deveria acontecer: o plano cria todo nível que vai usar. Se
        // acontecer, o produto fica sem categoria em vez de o lote inteiro
        // falhar — e o log diz qual.
        this.logger.warn(
          `Categoria "${vinculo.caminho.join(SEPARADOR_DE_NIVEL)}" não resolvida para o SKU ${vinculo.skuCode}.`,
        );
        continue;
      }
      await this.products.update(vinculo.productId, { categoryId });
      produtosVinculados++;
    }

    this.logger.log(
      `Importação de categorias do ERP concluída para o tenant ${tenantId}: ` +
        `${categoriasCriadas} categoria(s) criada(s), ${produtosVinculados} produto(s) vinculado(s).`,
    );

    return {
      categoriasCriadas,
      produtosVinculados,
      produtosSemCategoriaNoErp: plano.produtosSemCategoriaNoErp,
      produtosJaClassificados: plano.produtosJaClassificados,
    };
  }
}
