/**
 * Mostra a ESTRUTURA da resposta de produto.obter.php do Olist para um tenant.
 *
 * Uso:
 *   npx ts-node -T scripts/inspect-olist-product.ts <tenantId> [idDoProduto]
 *
 * Por que existe: o normalizador lê campos por nome (`comprimento`, `largura`,
 * `altura`, `peso_liquido`...) e esses nomes vieram de documentação, não de uma
 * resposta real autenticada. Quando um campo não bate, o efeito é um zero
 * silencioso — foi exatamente o que aconteceu com as dimensões no primeiro
 * sync real (peso veio, medidas vieram 0).
 *
 * Este script imprime as CHAVES da resposta e os valores dos campos físicos,
 * para conferir nome por nome contra o cadastro do ERP. Não imprime o token.
 */
import { writeFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { OlistApiClient } from '../src/modules/erp-integration/infrastructure/olist/olist-api.client';
import { CredentialEncryptionService } from '../src/shared/security/credential-encryption.service';
import { PrismaModule } from '../src/shared/prisma/prisma.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { TenantContextStore } from '../src/shared/prisma/tenant-context';

// NÃO importe o AppModule aqui. Ele registra ScheduleModule.forRoot() e, com
// ele, todos os @Cron do sistema — sync de ERP (30 min), de pedidos (10 min),
// de marketplace (5 min), monitor de concorrência (10 min). Um script de
// LEITURA que sobe o AppModule contra produção dispara jobs de ESCRITA, em
// todos os tenants, sob runAsService (RLS desligado), e o app.close() do
// finally pode cortar um deles no meio.
//
// Este módulo mínimo tem só o necessário para ler uma conexão e chamar a API.
// PrismaModule é @Global() e autocontido; OlistApiClient e
// CredentialEncryptionService não têm dependências de construtor.
// ConfigModule é obrigatório aqui: ele vive no AppModule e é quem carrega o
// .env. Sem ele, CredentialEncryptionService não enxerga
// ERP_CREDENTIALS_ENCRYPTION_KEY e cai no fallback de chave de
// desenvolvimento — a decifragem do token real não falha alto, devolve lixo.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [CredentialEncryptionService, OlistApiClient],
})
class InspectOlistModule {}

async function main() {
  const tenantId = process.argv[2];
  const produtoId = process.argv[3];
  if (!tenantId) {
    console.error('Uso: npx ts-node -T scripts/inspect-olist-product.ts <tenantId> [idDoProduto]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(InspectOlistModule, { logger: ['error'] });

  try {
    const prisma = app.get(PrismaService);
    const credentials = app.get(CredentialEncryptionService);
    const client = app.get(OlistApiClient);

    // O callback PRECISA ser async e aguardar aqui dentro. Prisma Promise é
    // preguiçosa: um `() => prisma.x.findUnique(...)` só CRIA a promise dentro
    // do contexto e a devolve — a execução real começa no await de fora, com o
    // AsyncLocalStorage já fechado, e a extensão de RLS (prisma.service.ts:36)
    // enxerga tenantId === undefined e derruba a consulta. É a forma usada em
    // todos os outros pontos do projeto (ex.: platform-admin.service.ts:33).
    const conexao = await TenantContextStore.run(tenantId, async () => {
      const encontrada = await prisma.olistConnection.findUnique({ where: { tenantId } });
      return encontrada;
    });
    if (!conexao) throw new Error(`Sem conexão Olist para o tenant ${tenantId}.`);

    const apiToken = credentials.decrypt(conexao.apiTokenEnc);

    // Sem id explícito: pega o primeiro da busca paginada.
    const alvo = produtoId ?? (await client.pesquisarProdutos(apiToken, 1)).produtos[0]?.id;
    if (!alvo) throw new Error('Nenhum produto encontrado na busca.');

    const bruto = (await client.obterProduto(apiToken, alvo)) as Record<string, unknown>;

    const linhas: string[] = [];
    linhas.push(`=== Produto ${alvo} — ${String(bruto.codigo ?? '?')} / ${String(bruto.nome ?? '?')}`, '');

    linhas.push('--- TODAS as chaves da resposta:', Object.keys(bruto).sort().join(', '), '');

    linhas.push('--- Campos que parecem físicos (peso/medida/embalagem):');
    for (const [chave, valor] of Object.entries(bruto)) {
      if (/peso|larg|alt|comprim|profund|dimens|embalag|volume|cubag/i.test(chave)) {
        linhas.push(`  ${chave} = ${JSON.stringify(valor)}`);
      }
    }

    linhas.push('', '--- Objetos aninhados (podem esconder as medidas):');
    for (const [chave, valor] of Object.entries(bruto)) {
      if (valor && typeof valor === 'object') {
        const dentro = Array.isArray(valor)
          ? `array[${valor.length}]${valor.length > 0 ? ' -> ' + Object.keys(valor[0] as object).join(', ') : ''}`
          : Object.keys(valor as object).join(', ');
        linhas.push(`  ${chave}: ${dentro}`);
      }
    }

    linhas.push('', '--- O que o normalizador lê hoje:');
    for (const chave of ['peso_liquido', 'peso_bruto', 'comprimento', 'largura', 'altura', 'ncm', 'gtin', 'categoria']) {
      linhas.push(`  ${chave} = ${JSON.stringify(bruto[chave])}`);
    }

    // Escrita SÍNCRONA: garante que a saída esteja em disco antes de qualquer
    // caminho de encerramento, sem depender do flush do stdout.
    const destino = process.env.OLIST_INSPECT_OUT ?? 'olist-inspect.txt';
    writeFileSync(destino, linhas.join('\n'), 'utf8');
    // eslint-disable-next-line no-console -- script de linha de comando: stdout é a interface
    console.log(`Estrutura escrita em ${destino}`);
  } finally {
    // Sem ScheduleModule não há timer segurando o event loop, então o processo
    // sai sozinho depois do close() — e o código de saída passa a ser real.
    // O process.exit(0) que ficava aqui mascarava falha como sucesso.
    await app.close();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
