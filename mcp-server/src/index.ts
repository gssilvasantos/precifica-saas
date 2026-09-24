import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { KyneteClient } from './kyneti-client';
import { registerKynetiTools } from './tools';

function requireEnv(name: string): string {
  const value = process.env[name];
  // Falha alto na inicialização quando falta variável obrigatória — mesma
  // regra do resto do repositório (.claude/rules/security.md), não um
  // fallback silencioso pra facilitar teste local.
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}. Veja .env.example.`);
  }
  return value;
}

const apiBaseUrl = requireEnv('KYNETI_API_BASE_URL');
const serviceEmail = requireEnv('KYNETI_SERVICE_EMAIL');
const servicePassword = requireEnv('KYNETI_SERVICE_PASSWORD');
const serviceTenantId = process.env.KYNETI_SERVICE_TENANT_ID || undefined;
const sharedSecret = requireEnv('MCP_SHARED_SECRET');
const port = Number(process.env.PORT) || 8787;
// v2 (24/09/2026) — desligado por padrão de propósito: ausente/qualquer
// valor diferente de "true" mantém o servidor 100% leitura, mesmo depois do
// deploy deste código. Ligar exige uma ação deliberada sua no painel do
// Render (Environment) — ver README "Ativando a escrita (v2)".
const writesEnabled = process.env.MCP_ALLOW_WRITES === 'true';

const kyneti = new KyneteClient({
  baseUrl: apiBaseUrl,
  email: serviceEmail,
  password: servicePassword,
  tenantId: serviceTenantId,
});

function buildServer(): McpServer {
  const server = new McpServer({ name: 'kyneti-mcp-server', version: '0.2.0' });
  registerKynetiTools(server, kyneti, writesEnabled);
  return server;
}

// Compara em tempo constante pra não vazar o segredo por timing attack —
// exagero pra a maioria dos casos, mas o custo aqui é uma linha.
function isAuthorized(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(sharedSecret);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthorized(req.header('authorization'))) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

const app = express();
app.use(express.json());

// Sem autenticação — só pra health check do Render.
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// Modo stateless (sessionIdGenerator: undefined): cada requisição MCP cria
// seu próprio Server + Transport e fecha no final. Simples e correto pra
// ferramentas de leitura sem streaming longo — ver docs do SDK ("stateless
// streamable http server"). Se um dia precisarmos de sessão persistente
// (ex.: subscriptions), isso vira um Map<sessionId, transport>.
app.post('/mcp', authMiddleware, async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    // Nunca vaza a senha da conta de serviço (não aparece em nenhum lugar
    // deste catch — só está em memória dentro de kyneti-client.ts).
    // eslint-disable-next-line no-console
    console.error('[kyneti-mcp-server] erro ao processar requisição MCP:', (error as Error).message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  }
});

// GET/DELETE em /mcp não fazem sentido no modo stateless (não há sessão pra
// retomar nem pra encerrar) — 405 explícito em vez de deixar o Express
// devolver um 404 genérico.
app.get('/mcp', authMiddleware, (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));
app.delete('/mcp', authMiddleware, (_req, res) => res.status(405).json({ error: 'method_not_allowed' }));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[kyneti-mcp-server] ouvindo na porta ${port} (base da API: ${apiBaseUrl}, escrita ${writesEnabled ? 'HABILITADA' : 'desabilitada'})`,
  );
});
