// Lógica de domínio pura — sem I/O, sem Prisma, sem NestJS. Calcula "o que
// significa" um conjunto de ofertas de concorrente coletadas: diferença de
// preço, ranking e status de Buy Box.
//
// DECISÃO DE ARQUITETURA (responde à pergunta "essa lógica fica aqui ou é
// serviço compartilhado?"): esta função fica DENTRO de Competition
// Intelligence porque ela só sabe interpretar FATOS de mercado (quem está
// cobrando quanto agora) — não decide se o Pricing Engine deve reagir. A
// DECISÃO de reagir (ex.: "se perdemos o Buy Box por menos de 5%, dispare
// reprecificação automática; se for mais que isso, só alerte um humano") é
// regra de Pricing Engine, não de Competition Intelligence — este módulo
// não conhece margem mínima, estratégia de preço nem o conceito de
// "reagir". Ele só emite o FATO calculado (via evento) e quem decide reagir
// é quem assina o evento. Essa fronteira é o que mantém os dois módulos
// desacoplados: Competition Intelligence não precisa saber que Pricing
// Engine existe para funcionar.

export interface OpportunityOffer {
  competitorLabel: string;
  price: number;
  isBuyBoxWinner?: boolean;
}

export interface OpportunityInput {
  ourPrice: number | null;
  offers: OpportunityOffer[];
}

export interface OpportunityResult {
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  priceGapPct: number; // (ourPrice - bestCompetitorPrice) / bestCompetitorPrice; negativo = estamos mais baratos
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null; // 1 = mais barato do conjunto (incluindo nós, se ourPrice existir)
}

export class InvalidOpportunityInputError extends Error {}

export function calculateOpportunity(input: OpportunityInput): OpportunityResult {
  if (input.offers.length === 0) {
    throw new InvalidOpportunityInputError('Não é possível calcular oportunidade sem nenhuma oferta de concorrente.');
  }
  if (input.offers.some((o) => !Number.isFinite(o.price) || o.price <= 0)) {
    throw new InvalidOpportunityInputError('Todas as ofertas de concorrente precisam ter price > 0.');
  }

  const best = input.offers.reduce((min, o) => (o.price < min.price ? o : min), input.offers[0]);

  const priceGapPct =
    input.ourPrice != null && input.ourPrice > 0 ? (input.ourPrice - best.price) / best.price : 0;

  let buyBoxStatus: OpportunityResult['buyBoxStatus'] = 'UNKNOWN';
  if (input.ourPrice != null) {
    buyBoxStatus = input.ourPrice <= best.price ? 'WINNING' : 'LOSING';
  }

  let rank: number | null = null;
  if (input.ourPrice != null) {
    const allPrices = [...input.offers.map((o) => o.price), input.ourPrice].sort((a, b) => a - b);
    rank = allPrices.indexOf(input.ourPrice) + 1;
  }

  return {
    bestCompetitorPrice: best.price,
    bestCompetitorLabel: best.competitorLabel,
    priceGapPct,
    buyBoxStatus,
    rank,
  };
}
