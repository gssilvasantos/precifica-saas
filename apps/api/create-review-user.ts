// Cria (ou reseta a senha de) um usuário DEDICADO para revisão externa de
// parceiros de plataforma (Shopee/TikTok/Amazon/Magalu) — mesmo tenant da
// conta demo ("Loja Demo", id fixo, ver prisma/seed-demo.ts), mas login e
// senha PRÓPRIOS, separados do `demo@precifica.dev` usado internamente
// (testes/apresentação a investidores). Motivo: evitar reusar a mesma
// credencial para público externo e interno — dá pra revogar/trocar a senha
// de revisão a qualquer momento sem afetar o resto.
//
// Role VIEWER (não ADMIN) — leitura apenas (dashboard, relatórios,
// Integrações). Suficiente para o que a Shopee pede (ver a seção de
// Integrações mostrando conexões ativas); não permite conectar/desconectar/
// editar nada, reduzindo o risco de uma credencial externa alterar dado real.
//
// Rodar: cd apps/api && npx ts-node create-review-user.ts
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001'; // "Loja Demo", mesmo tenant do seed-demo.ts
const REVIEW_EMAIL = 'revisao-parceiros@precifica.dev';
const REVIEW_PASSWORD = 'KynetiParceiro2026!';
const SALT_ROUNDS = 12; // mesmo valor de UsersService — hash compatível com o login real

async function main() {
  await prisma.$transaction(async (tx) => {
    // Mesma válvula de bypass usada por seed-demo.ts/test-rls.ts — SET LOCAL
    // (terceiro argumento 'true'), vale só dentro desta transação.
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    const tenant = await tx.tenant.findUnique({ where: { id: TENANT_ID } });
    if (!tenant) {
      throw new Error(
        `Tenant demo (${TENANT_ID}) não encontrado — rode "npx ts-node prisma/seed-demo.ts" primeiro.`,
      );
    }

    const passwordHash = await bcrypt.hash(REVIEW_PASSWORD, SALT_ROUNDS);
    await tx.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: REVIEW_EMAIL } },
      create: {
        tenantId: tenant.id,
        name: 'Revisão de Parceiros',
        email: REVIEW_EMAIL,
        passwordHash,
        role: 'VIEWER',
      },
      update: { passwordHash, role: 'VIEWER' }, // reseta a senha pro valor conhecido a cada rodada
    });
  });

  console.log('\nUsuário de revisão pronto. Credenciais para informar a parceiros externos:');
  console.log(`  URL:   https://kyneti.com.br`);
  console.log(`  E-mail: ${REVIEW_EMAIL}`);
  console.log(`  Senha:  ${REVIEW_PASSWORD}`);
  console.log('\nPapel: VIEWER (só leitura — não conecta/desconecta integrações nem edita nada).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
