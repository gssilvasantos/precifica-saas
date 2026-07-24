// Isola se o problema é no banco (RLS/bypass não deixando a query enxergar
// a linha) ou na aplicação (contexto de tenant perdido em algum ponto do
// pipeline do NestJS antes de chegar no bcrypt.compare). Roda EXATAMENTE a
// mesma query que PrismaUserRepository.findAllByEmail faz, com o mesmo
// mecanismo de bypass que o TenantContextInterceptor deveria abrir para
// rotas públicas (login/signup) — só que aqui, direto, sem depender do
// AsyncLocalStorage/Observable do Nest.
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const prisma = new PrismaClient();

const EMAIL = 'demo@precifica.dev';
const PASSWORD = 'demo12345678';

async function run() {
  try {
    const matches = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      // Mesma forma exata de PrismaUserRepository.findAllByEmail:
      return tx.user.findMany({ where: { email: EMAIL }, include: { tenant: true } });
    });

    console.log(`Linhas encontradas via app_runtime + bypass explícito: ${matches.length}`);

    if (matches.length === 0) {
      console.log(
        '=> Mesmo com bypass explícito e correto neste script, a query não vê a linha.\n' +
          '   Isso apontaria para um problema no nível do banco (grant faltando,\n' +
          '   RLS mal configurada) — não no NestJS.',
      );
      return;
    }

    console.log(
      '=> A query enxerga a linha perfeitamente com app_runtime + bypass explícito.\n' +
        '   Isso indica que o banco/grants estão OK, e o 401 em produção é causado\n' +
        '   por algo no pipeline do NestJS (contexto de tenant não chegando até o\n' +
        '   AuthService da forma esperada) — não no banco.',
    );

    for (const m of matches) {
      const ok = await bcrypt.compare(PASSWORD, m.passwordHash);
      console.log(
        `Usuário ${m.email} (tenant ${m.tenantId}) — isActive=${m.isActive} — ` +
          `bcrypt.compare('${PASSWORD}', passwordHash) = ${ok}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

run();

async function fixPassword() {
  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash('demo12345678', salt);
  
  // Atualiza o banco com o hash legítimo gerado pelo bcrypt da lib
  // (ou você pode rodar o UPDATE no Supabase com esse novo hash gerado)
  console.log("Novo hash gerado:", hash);
}
fixPassword();