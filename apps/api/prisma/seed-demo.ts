// Seed de DEMONSTRAÇÃO — separado do prisma/seed.ts (que semeia dado de
// PLATAFORMA: marketplaces, schedules). Este script cria uma conta fake
// completa (tenant + usuário + produtos + vínculo Nuvemshop + regra de taxa
// já validada) para testar a tela de precificação sem depender de conexão
// real com Olist/Nuvemshop nem do fluxo de signup.
//
// Rodar: cd apps/api && npx ts-node prisma/seed-demo.ts
// (ou "npm run prisma:seed:demo", se você adicionar o script no package.json)
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { computeContentHash } from '../src/shared/domain/content-hash';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@precifica.dev';
const DEMO_PASSWORD = 'demo12345678';
const SALT_ROUNDS = 12; // mesmo valor de UsersService — mantém o hash compatível com o login real

// grossPrice = 100 para os três produtos, taxa 1x/0d = 3.99% (ver abaixo) —
// os três custos foram escolhidos para cair exatamente numa faixa do
// semáforo na visão padrão da tela (1x, recebimento na hora, sem frete
// grátis/cupom), sem precisar mexer nos controles de cenário.
const DEMO_PRODUCTS = [
  { skuCode: 'CAM-001', name: 'Camiseta Básica Branca P', costPrice: 60, grossPrice: 100 }, // margem ~36% (verde)
  { skuCode: 'TEN-002', name: 'Tênis Urbano Preto 42', costPrice: 78, grossPrice: 100 }, // margem ~18% (amarelo)
  { skuCode: 'BON-003', name: 'Boné Aba Reta Cinza', costPrice: 90, grossPrice: 100 }, // margem ~6% (vermelho)
];

// Algumas combinações comuns de parcela x janela de recebimento — o
// simulador funciona com qualquer combinação que não esteja aqui também,
// só retorna feeRuleFound: false e assume 0% (ver NuvemshopMarginSimulatorService).
const DEMO_GATEWAY_FEES = [
  { installments: 1, receivingWindowDays: 0, commissionPct: 3.99 },
  { installments: 3, receivingWindowDays: 0, commissionPct: 5.49 },
  { installments: 6, receivingWindowDays: 0, commissionPct: 7.99 },
  { installments: 1, receivingWindowDays: 14, commissionPct: 3.29 },
  { installments: 3, receivingWindowDays: 14, commissionPct: 4.79 },
  { installments: 1, receivingWindowDays: 30, commissionPct: 2.49 },
];

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // Mesma válvula de bypass que os schedulers da aplicação usam
      // (TenantContextStore.runAsService -> set_config('app.bypass_rls', ...)),
      // já prevista em toda policy tenant_isolation. set_config de um GUC
      // customizado (namespace "app.") não exige privilégio nenhum — por
      // isso dá pra rodar o seed inteiro com app_runtime (sem BYPASSRLS),
      // sem precisar de DIRECT_URL/postgres nem desligar RLS na tabela.
      // IMPORTANTE: 'true' no terceiro argumento = SET LOCAL (vale só
      // dentro desta transação) — nunca use set_config sem o terceiro
      // argumento aqui, ou o bypass vazaria para a próxima transação que
      // pegar essa mesma conexão física do pooler (ver seção 2 do
      // docs/row-level-security-architecture.md).
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

      console.log('Criando tenant + usuário demo...');
      const tenant = await tx.tenant.upsert({
        where: { id: '00000000-0000-0000-0000-000000000001' },
        create: { id: '00000000-0000-0000-0000-000000000001', name: 'Loja Demo' },
        update: {},
      });

      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
      await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: DEMO_EMAIL } },
        create: {
          tenantId: tenant.id,
          name: 'Usuário Demo',
          email: DEMO_EMAIL,
          passwordHash,
          role: 'ADMIN',
        },
        update: { passwordHash }, // reseta a senha pro valor conhecido a cada rodada do seed
      });

      console.log('Garantindo marketplace NUVEMSHOP...');
      const nuvemshop = await tx.marketplace.upsert({
        where: { code: 'NUVEMSHOP' },
        create: { code: 'NUVEMSHOP', displayName: 'Nuvemshop (loja própria)' },
        update: {},
      });

      console.log('Criando produtos demo...');
      for (const p of DEMO_PRODUCTS) {
        await tx.product.upsert({
          where: { tenantId_skuCode: { tenantId: tenant.id, skuCode: p.skuCode } },
          create: {
            tenantId: tenant.id,
            skuCode: p.skuCode,
            name: p.name,
            costPrice: p.costPrice,
            desiredMarginPct: 25,
            minimumMarginPct: 10,
            weightKg: 0.3,
            packagingWeightKg: 0.05,
            packedWeightKg: 0.35,
            lengthCm: 30,
            widthCm: 20,
            heightCm: 8,
            cubicWeightKg: 0.32,
            shippingWeightKg: 0.35,
            stockQuantity: 50,
            photoUrls: [],
            sourceSystem: 'MANUAL',
            isActive: true,
          },
          update: { costPrice: p.costPrice, name: p.name },
        });

        console.log(`  - Vinculando ${p.skuCode} à Nuvemshop (preço R$ ${p.grossPrice})...`);
        await tx.channelListing.upsert({
          where: {
            tenantId_channelCode_externalId: {
              tenantId: tenant.id,
              channelCode: 'NUVEMSHOP',
              externalId: `demo-${p.skuCode}`,
            },
          },
          create: {
            tenantId: tenant.id,
            skuCode: p.skuCode,
            channelCode: 'NUVEMSHOP',
            externalId: `demo-${p.skuCode}`,
            currentPrice: p.grossPrice,
            url: null,
          },
          update: { currentPrice: p.grossPrice },
        });
      }

      console.log('Cadastrando taxas de gateway da Nuvemshop já validadas (sem precisar de sync real)...');
      for (const fee of DEMO_GATEWAY_FEES) {
        const scopeKey = `${fee.installments}x_${fee.receivingWindowDays}d`;
        const payload = { commissionPct: fee.commissionPct, fixedFeeAmount: 0 };
        await tx.marketplaceRule.upsert({
          where: {
            marketplaceId_ruleType_scopeKey_version_tenantId: {
              marketplaceId: nuvemshop.id,
              ruleType: 'FEE_RULE',
              scopeKey,
              version: 1,
              tenantId: tenant.id,
            },
          },
          create: {
            marketplaceId: nuvemshop.id,
            ruleType: 'FEE_RULE',
            scopeKey,
            payload,
            version: 1,
            status: 'VALIDADA',
            sourceType: 'MANUAL',
            sourceProviderCode: 'SEED_DEMO',
            sourceFetchedAt: new Date(),
            contentHash: computeContentHash(payload),
            tenantId: tenant.id,
            validatedAt: new Date(),
          },
          update: { payload, contentHash: computeContentHash(payload) },
        });
      }
    },
    { timeout: 20000 }, // várias upserts em sequência via pooler — margem além do default de 5s
  );

  console.log('\nSeed demo concluído. Credenciais para login:');
  console.log(`  E-mail: ${DEMO_EMAIL}`);
  console.log(`  Senha:  ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
