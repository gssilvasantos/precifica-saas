import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Marketplace é dado, não enum (ver docs/marketplace-intelligence-architecture.md,
// seção 2.1) — este seed é o único lugar que precisa mudar para "cadastrar"
// um canal novo na plataforma, mesmo antes de existir um provider funcional
// para ele.
const MARKETPLACES = [
  { code: 'MERCADO_LIVRE', displayName: 'Mercado Livre' },
  { code: 'SHOPEE', displayName: 'Shopee' },
  { code: 'TIKTOK_SHOP', displayName: 'TikTok Shop' },
  { code: 'AMAZON', displayName: 'Amazon' },
  { code: 'MAGALU', displayName: 'Magalu' },
  { code: 'SHEIN', displayName: 'SHEIN' },
  // Nuvemshop entra na mesma tabela Marketplace mesmo sendo a "loja própria",
  // não um marketplace de terceiros — estruturalmente, a taxa dinâmica do
  // Nuvem Pago é modelada como MarketplaceRule igual a qualquer comissão de
  // marketplace (ver NuvemshopFeeRuleProvider). Reaproveitar a mesma tabela
  // evita inventar um conceito paralelo só por causa do nome.
  { code: 'NUVEMSHOP', displayName: 'Nuvemshop (loja própria)' },
];

async function main() {
  console.log('Semeando marketplaces...');
  const marketplacesByCode = new Map<string, string>();

  for (const marketplace of MARKETPLACES) {
    const record = await prisma.marketplace.upsert({
      where: { code: marketplace.code },
      create: marketplace,
      update: { displayName: marketplace.displayName },
    });
    marketplacesByCode.set(record.code, record.id);
    console.log(`  - ${record.displayName} (${record.code})`);
  }

  console.log('Configurando schedule de sincronização do Mercado Livre...');
  const mercadoLivreId = marketplacesByCode.get('MERCADO_LIVRE');
  if (mercadoLivreId) {
    await prisma.providerSyncSchedule.upsert({
      where: { providerCode: 'MERCADO_LIVRE_API_V1' },
      create: {
        providerCode: 'MERCADO_LIVRE_API_V1',
        marketplaceId: mercadoLivreId,
        capability: 'FEE_RULES',
        intervalMinutes: 1440, // diário
        autoTrust: false, // decisão já confirmada: sempre pendente de aprovação no início
      },
      update: {},
    });
  }

  console.log('Configurando schedule de sincronização da taxa de gateway da Nuvemshop...');
  const nuvemshopId = marketplacesByCode.get('NUVEMSHOP');
  if (nuvemshopId) {
    await prisma.providerSyncSchedule.upsert({
      where: { providerCode: 'NUVEMSHOP_GATEWAY_FEES' },
      create: {
        providerCode: 'NUVEMSHOP_GATEWAY_FEES',
        marketplaceId: nuvemshopId,
        capability: 'FEE_RULES',
        intervalMinutes: 1440, // diário — mesma cadência do Mercado Livre
        autoTrust: false, // mesma decisão de governança: sempre pendente de aprovação
      },
      update: {},
    });
  }

  console.log('Configurando schedule de sincronização de listings da Nuvemshop (vínculo por SKU)...');
  await prisma.providerSyncSchedule.upsert({
    where: { providerCode: 'NUVEMSHOP_CHANNEL_LISTINGS' },
    create: {
      providerCode: 'NUVEMSHOP_CHANNEL_LISTINGS',
      marketplaceId: 'NUVEMSHOP', // referência solta (não FK), mesmo padrão do OLIST_TINY_API_V2
      capability: 'CHANNEL_LISTINGS',
      intervalMinutes: 60,
      autoTrust: false, // não usado por este capability — mantido por consistência do modelo
    },
    update: {},
  });

  console.log('Configurando schedule de sincronização do ERP Integration (Olist)...');
  await prisma.providerSyncSchedule.upsert({
    where: { providerCode: 'OLIST_TINY_API_V2' },
    create: {
      providerCode: 'OLIST_TINY_API_V2',
      marketplaceId: 'ERP_OLIST', // referência solta, não FK (ver schema.prisma) — este provider não é um Marketplace
      capability: 'ERP_CATALOG',
      intervalMinutes: 60,
      autoTrust: false, // não usado pelo ERP Integration (ele já aplica direto), mantido por consistência do modelo
    },
    update: {},
  });

  console.log('Configurando schedule de monitoramento do Competition Intelligence...');
  await prisma.providerSyncSchedule.upsert({
    where: { providerCode: 'COMPETITION_RADAR_MONITOR' },
    create: {
      providerCode: 'COMPETITION_RADAR_MONITOR',
      marketplaceId: 'COMPETITION_RADAR', // referência solta, não FK — mesmo padrão do OLIST_TINY_API_V2
      capability: 'COMPETITOR_MONITORING',
      intervalMinutes: 10,
      autoTrust: false, // não usado por este capability — mantido por consistência do modelo
    },
    update: {},
  });

  console.log('Seed concluído.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
