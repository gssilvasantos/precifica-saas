// Imposto de um item = receita do item × alíquota efetiva (fração), arredondado
// a centavos. Função pura: a alíquota vem do Tax Intelligence, nunca é
// decidida aqui.
//
// Simplificação consciente: a alíquota incide sobre o totalPrice do item
// (preço de venda), sem rateio de desconto de pedido. O DAS do Simples é
// apurado sobre a receita bruta, então esta é a base correta para o regime
// atual; Presumido/Real e CBS/IBS por fora (2027+) exigirão base própria.
export function computeItemTaxAmount(totalPrice: number, effectiveRate: number): number {
  if (!Number.isFinite(totalPrice) || !Number.isFinite(effectiveRate) || totalPrice <= 0 || effectiveRate <= 0) return 0;
  return Math.round((totalPrice * effectiveRate + Number.EPSILON) * 100) / 100;
}
