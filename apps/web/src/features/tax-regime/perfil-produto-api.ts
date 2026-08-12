import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/tax-intelligence/interface/controllers/
// product-tax-profile.controller.ts. Cópia manual do contrato — mudou lá,
// atualize aqui na MESMA fatia.

export const FONTES_DE_CLASSIFICACAO = [
  'MANUAL',
  'ERP_OLIST',
  'PORTARIA_SRE_94_2025',
  'LEI_10147_2000',
  'CONVENIO_ICMS_142_2018',
] as const;

export type FonteDeClassificacao = (typeof FONTES_DE_CLASSIFICACAO)[number];

// Rótulos legíveis. A norma é o dado; o texto é só a apresentação dela.
export const ROTULO_DA_FONTE: Record<FonteDeClassificacao, string> = {
  MANUAL: 'Classificação própria (manual)',
  ERP_OLIST: 'Importada do Olist',
  PORTARIA_SRE_94_2025: 'Portaria SRE 94/2025 (saída da ST em SP)',
  LEI_10147_2000: 'Lei 10.147/2000 (monofásico)',
  CONVENIO_ICMS_142_2018: 'Convênio ICMS 142/2018 (regras gerais de ST)',
};

export interface PerfilFiscalDeProduto {
  id: string;
  productId: string;
  uf: string;
  icmsSt: boolean;
  monofasico: boolean;
  ncm: string | null;
  fonte: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
}

export interface ClassificarProdutoInput {
  uf: string;
  icmsSt: boolean;
  monofasico: boolean;
  ncm?: string | null;
  fonte: FonteDeClassificacao;
  vigenciaInicio: string; // ISO 8601
}

// Lista mínima para o seletor. Só id, SKU e nome interessam aqui — o resto do
// produto é assunto do módulo de catálogo.
export interface ProdutoParaClassificar {
  id: string;
  skuCode: string;
  name: string;
}

export async function fetchProdutosParaClassificar(): Promise<ProdutoParaClassificar[]> {
  const { data } = await apiClient.get<ProdutoParaClassificar[]>('/products');
  return data.map((p) => ({ id: p.id, skuCode: p.skuCode, name: p.name }));
}

export async function fetchPerfisDoProduto(productId: string): Promise<PerfilFiscalDeProduto[]> {
  const { data } = await apiClient.get<PerfilFiscalDeProduto[]>(
    `/tax-intelligence/produtos/${productId}/perfil-fiscal`,
  );
  return data;
}

// POST e não PUT: cada chamada acrescenta uma vigência ao histórico daquela
// UF, não substitui um recurso.
export async function classificarProduto(
  productId: string,
  input: ClassificarProdutoInput,
): Promise<PerfilFiscalDeProduto> {
  const { data } = await apiClient.post<PerfilFiscalDeProduto>(
    `/tax-intelligence/produtos/${productId}/perfil-fiscal`,
    input,
  );
  return data;
}
