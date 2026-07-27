// Script de diagnóstico ÚNICO — chama a API REAL do Mercado Livre
// (/orders/search) com EXATAMENTE os mesmos parâmetros que
// MercadoLivreApiClient.fetchOrders usa em produção, e imprime a resposta
// bruta. Objetivo: descobrir se o próprio Mercado Livre está devolvendo
// zero resultados para o filtro de data usado (bug no parâmetro/formato),
// ou se a API acha pedidos normalmente e o problema está em outra camada
// do nosso código (normalizador, etc.) — ver diagnose-ml-sync.ts, que
// mostrou candidatesFound: 0 em toda tentativa desde ontem à noite.
//
// Rodar: cd apps/api && npx ts-node diagnose-ml-search-raw.ts
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';
import { createDecipheriv, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function decrypt(cipherPayload: string): string {
  const secret = process.env.ERP_CREDENTIALS_ENCRYPTION_KEY;
  const key = scryptSync(secret ?? 'dev-only-insecure-key', 'precifica-erp-integration', 32);
  const [ivB64, authTagB64, dataB64] = cipherPayload.split('.');
  if (!ivB64 || !authTagB64 || !dataB64) throw new Error('Payload de credencial em formato inesperado.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

async function main() {
  const connection = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return tx.mercadoLivreConnection.findUnique({ where: { tenantId: TENANT_ID } });
  });

  if (!connection) {
    console.log('Nenhuma conexão encontrada.');
    return;
  }

  console.log(`Descriptografando access token (key presente no .env local? ${Boolean(process.env.ERP_CREDENTIALS_ENCRYPTION_KEY)})...`);
  let accessToken: string;
  try {
    accessToken = decrypt(connection.accessTokenEnc);
    console.log('Descriptografado com sucesso. Tamanho do token:', accessToken.length);
  } catch (error) {
    console.error('FALHA ao descriptografar — a chave local (.env) provavelmente é DIFERENTE da usada em produção (Render).');
    console.error((error as Error).message);
    return;
  }

  const sellerId = connection.sellerId;
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Teste 1: EXATAMENTE a mesma URL que o client de produção monta hoje.
  const urlWithFilter = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&offset=0&limit=50&order.date_last_updated.from=${since90.toISOString()}`;
  console.log('\n=== Teste 1: com filtro de data (igual à produção) ===');
  console.log('URL:', urlWithFilter);
  const res1 = await fetch(urlWithFilter, { headers: { Authorization: `Bearer ${accessToken}` } });
  console.log('Status HTTP:', res1.status);
  const body1 = await res1.text();
  console.log('Corpo (primeiros 2000 chars):', body1.slice(0, 2000));

  // Teste 2: SEM o filtro de data, só paginação — pra confirmar que o
  // token/seller funcionam e existem pedidos de verdade (mesmo caminho do
  // handshake que já achou milhares antes).
  const urlNoFilter = `https://api.mercadolibre.com/orders/search?seller=${sellerId}&offset=0&limit=10`;
  console.log('\n=== Teste 2: SEM filtro de data (baseline) ===');
  console.log('URL:', urlNoFilter);
  const res2 = await fetch(urlNoFilter, { headers: { Authorization: `Bearer ${accessToken}` } });
  console.log('Status HTTP:', res2.status);
  const body2 = await res2.text();
  console.log('Corpo (primeiros 2000 chars):', body2.slice(0, 2000));
}

main()
  .catch((error) => console.error(error))
  .finally(async () => {
    await prisma.$disconnect();
  });
