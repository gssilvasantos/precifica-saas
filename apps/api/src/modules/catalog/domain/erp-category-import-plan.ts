// Plano de importação da árvore de categorias vinda de um ERP.
//
// Domínio puro: recebe o que existe, devolve o que seria feito. Nenhum I/O,
// nenhuma escrita — é isso que permite mostrar a prévia ao usuário antes de
// tocar no catálogo.
//
// POR QUE ISTO É UMA AÇÃO SEPARADA, E NÃO PARTE DO SYNC (decisão do usuário,
// 02/08/2026): a categoria do Kyneti é organizada pelo próprio lojista e não
// precisa espelhar a do ERP — a estrutura do Olist é uma organização
// particular dele, não uma verdade a ser replicada. O sync só REGISTRA o
// caminho de origem em Product.internalCategory (texto livre). Transformar
// isso em árvore estruturada é conveniência de MIGRAÇÃO: roda quando o usuário
// pede, uma vez, e depois a árvore é dele.
//
// Consequência de desenho: este planejador nunca renomeia, move nem remove
// categoria existente. Só cria o que falta e vincula produto que ainda não tem
// categoria.

export interface ProdutoComCategoriaDeOrigem {
  productId: string;
  skuCode: string;
  // Caminho como texto, do jeito que o ERP entregou: 'ROSTO > BASE > BASE LÍQUIDA'.
  erpCategoryPath: string | null;
  // Categoria já atribuída no Kyneti. Produto que já tem categoria não é
  // tocado — o usuário decidiu, e a migração não desfaz decisão.
  categoryId: string | null;
}

export interface CategoriaExistente {
  id: string;
  name: string;
  parentCategoryId: string | null;
}

export interface CategoriaACriar {
  // Caminho completo, para exibir na prévia: ['ROSTO', 'BASE'].
  caminho: string[];
  name: string;
  // Caminho do pai; vazio = raiz. Como o pai pode ainda não existir, o vínculo
  // é resolvido por caminho na hora de aplicar, não por id.
  caminhoDoPai: string[];
}

export interface VinculoPlanejado {
  productId: string;
  skuCode: string;
  caminho: string[];
}

export interface PlanoDeImportacao {
  categoriasACriar: CategoriaACriar[];
  vinculos: VinculoPlanejado[];
  // Produtos que o ERP não classificou — ficam de fora e são contados, para o
  // usuário não achar que a importação "perdeu" itens.
  produtosSemCategoriaNoErp: number;
  // Produtos que já têm categoria no Kyneti e por isso não são mexidos.
  produtosJaClassificados: number;
}

export const SEPARADOR_DE_NIVEL = ' > ';

function chaveDoCaminho(caminho: string[]): string {
  // Case-insensitive: 'Rosto' e 'ROSTO' são a mesma categoria. Sem isso a
  // importação criaria irmãs duplicadas que só diferem por caixa.
  return caminho.map((n) => n.trim().toLowerCase()).join(SEPARADOR_DE_NIVEL);
}

// Indexa a árvore existente por caminho completo, para saber o que já existe
// sem depender de ordem de criação.
function indexarPorCaminho(categorias: CategoriaExistente[]): Map<string, string> {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const indice = new Map<string, string>();

  for (const categoria of categorias) {
    const caminho: string[] = [];
    let atual: CategoriaExistente | undefined = categoria;
    // Guarda contra ciclo: uma árvore corrompida não pode travar o servidor.
    const visitados = new Set<string>();

    while (atual && !visitados.has(atual.id)) {
      visitados.add(atual.id);
      caminho.unshift(atual.name);
      atual = atual.parentCategoryId ? porId.get(atual.parentCategoryId) : undefined;
    }

    indice.set(chaveDoCaminho(caminho), categoria.id);
  }

  return indice;
}

export function planejarImportacaoDeCategorias(
  produtos: ProdutoComCategoriaDeOrigem[],
  categoriasExistentes: CategoriaExistente[],
): PlanoDeImportacao {
  const existentes = indexarPorCaminho(categoriasExistentes);

  const aCriar = new Map<string, CategoriaACriar>();
  const vinculos: VinculoPlanejado[] = [];
  let semCategoria = 0;
  let jaClassificados = 0;

  for (const produto of produtos) {
    const caminho = (produto.erpCategoryPath ?? '')
      .split(/\s*>+\s*/)
      .map((n) => n.trim())
      .filter((n) => n !== '');

    if (caminho.length === 0) {
      semCategoria++;
      continue;
    }

    // Cada nível intermediário também precisa existir: importar
    // 'ROSTO > BASE > BASE LÍQUIDA' cria os três, não só a folha.
    for (let i = 0; i < caminho.length; i++) {
      const parcial = caminho.slice(0, i + 1);
      const chave = chaveDoCaminho(parcial);
      if (existentes.has(chave) || aCriar.has(chave)) continue;
      aCriar.set(chave, { caminho: parcial, name: parcial[i], caminhoDoPai: caminho.slice(0, i) });
    }

    if (produto.categoryId !== null) {
      jaClassificados++;
      continue;
    }
    vinculos.push({ productId: produto.productId, skuCode: produto.skuCode, caminho });
  }

  return {
    // Ordenado por profundidade: garante que o pai seja criado antes do filho
    // quando o plano for aplicado em sequência.
    categoriasACriar: [...aCriar.values()].sort((a, b) => a.caminho.length - b.caminho.length),
    vinculos,
    produtosSemCategoriaNoErp: semCategoria,
    produtosJaClassificados: jaClassificados,
  };
}
