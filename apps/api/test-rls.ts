import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// `import 'dotenv/config'` sozinho resolve o .env relativo ao cwd de quem
// chamou `ts-node` — se você rodar o comando de fora de apps/api/ (ex.: da
// raiz do monorepo), ele procura um .env que não existe ali e falha
// silenciosamente, sem erro nenhum de "arquivo não encontrado" (só o erro
// deste script, "Environment variable not found: DATABASE_URL", quando o
// Prisma tenta usar a env var que nunca foi carregada). Resolver o caminho a
// partir de __dirname torna isso independente de onde o comando é chamado.
const envPath = path.resolve(__dirname, '.env');
const dotenvResult = dotenv.config({ path: envPath });

// dotenv.config() NUNCA lança exceção — se o arquivo não existir ou não der
// para ler, ele só devolve { error: ... } e segue em frente. É por isso que
// o erro que apareceu foi do Prisma ("Environment variable not found"), não
// um erro claro de "arquivo .env não encontrado". Log explícito aqui para
// não continuar adivinhando às cegas.
console.log('Procurando .env em:', envPath);
if (dotenvResult.error) {
  console.log('Falha ao carregar o .env:', dotenvResult.error.message);
} else {
  console.log('.env carregado. Chaves encontradas:', Object.keys(dotenvResult.parsed ?? {}));
}
console.log('DATABASE_URL está definida?', Boolean(process.env.DATABASE_URL));

const prisma = new PrismaClient();

// IDs já conhecidos dos dois tenants de teste (ver histórico de testes
// anteriores): Tenant A é a conta seed/demo, Tenant B foi criado via
// POST /auth/signup. Hardcoded aqui de propósito — com app_runtime (sujeito
// a RLS de verdade, sem bypass), uma query de "descoberta" sem contexto de
// tenant já setado retorna 0 linhas por definição (é a RLS funcionando
// corretamente), então não dá mais para descobrir os IDs às cegas como
// antes com o role postgres.
const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = 'acaab549-2b48-4287-b4b1-fd2b54189121';

async function run() {
  try {
    console.log('Tenant A:', TENANT_A);
    console.log('Tenant B:', TENANT_B);

    // Executa a transação simulando o contexto do Tenant B tentando ler registros do Tenant A
    const result: any[] = await prisma.$transaction(async (tx) => {
      // Seta a variável de sessão do RLS para o Tenant B
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${TENANT_B}, true)`;

      // Tenta buscar dados que pertencem ao Tenant A
      return await tx.$queryRaw`SELECT * FROM "identity"."users" WHERE "tenantId" = ${TENANT_A}`;
    });

    console.log('Resultado da busca cruzada (Tenant B tentando ver Tenant A):', result);
    
    if (result.length === 0) {
      console.log('\nSUCESSO ABSOLUTO! O RLS bloqueou o acesso e retornou vazio (0 registros).');
    } else {
      console.log('\nFALHA! O Tenant B conseguiu ver dados do Tenant A.');
    }
  } catch (err: any) {
    console.log('Erro durante o teste:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();