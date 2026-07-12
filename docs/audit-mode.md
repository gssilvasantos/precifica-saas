# Modo de Demonstração (Audit Mode)

**Status:** cobre a infraestrutura de dados de teste do Kyneti — o `AuditSeederService` (10 pedidos fictícios cobrindo os cenários financeiros pedidos pela auditoria técnica da Shopee), a flag `isDemo` e a segregação estrutural entre dados reais e fictícios, e o controle de estado `appMode` no frontend (toggle Admin-only no Dashboard). Este documento existe para ser anexado à solicitação de auditoria da Shopee como evidência de que o Kyneti tem um ambiente de teste isolado do ambiente de produção da Rita Mazzei Beauty.

## 1. Por que este recurso existe

Duas necessidades convergiram na mesma solução: (a) a auditoria técnica da Shopee precisa ver o sistema funcionando com pedidos e margens variadas, sem acesso aos dados comerciais reais da loja; (b) apresentações e demos do Kyneti (para investidores, novos clientes, ou a própria Shopee) precisam de um estado de dados previsível e repetível, que a operação real do dia a dia não garante. Em vez de duas soluções separadas (um banco de staging à parte, ou capturas de tela estáticas), o Audit Mode injeta pedidos fictícios no MESMO banco de produção, marcados de forma que nunca aparecem misturados com dado real — a prova de isolamento fica na própria arquitetura de leitura, não em um ambiente físico separado.

## 2. `AuditSeederService` — os 10 cenários

`apps/api/src/modules/orders/application/audit-seeder.service.ts` injeta exatamente 10 pedidos com `externalOrderId` fixo (`DEMO-AUDIT-001` a `DEMO-AUDIT-010`), cobrindo:

| # | Cenário | Canal | O que demonstra |
|---|---|---|---|
| 001 | Margem positiva alta | Nuvemshop | Taxa zero (canal próprio), custo baixo, margem líquida robusta. |
| 002 | Margem positiva moderada | Mercado Livre | Comissão de marketplace padrão deduzida do repasse. |
| 003 | Margem **negativa** | Shopee | Frete subsidiado + cupom + taxa corroem a margem até negativa. |
| 004 | Frete **alto** | Nuvemshop | Frete domina o custo total do pedido (item volumoso/remoto). |
| 005 | Taxa **alta/variada** | Mercado Livre | Comissão de anúncio Premium, bem acima da média. |
| 006 | Pedido em aberto | Shopee | Worklist com um pedido "vivo" (`EM_ABERTO`), não só histórico. |
| 007 | **Cancelado** | Nuvemshop | Regra de Ouro do DRE (Etapa 20): pedido cancelado nunca entra na receita reconhecida. |
| 008 | Custo **desconhecido** | Mercado Livre | Item sem SKU resolvido — margem fica `UNKNOWN`, nunca fabricada em zero. |
| 009 | Taxa zero **suspeita** | Shopee | Aciona a heurística `isFeeSuspicious` do DRE (Shopee não é canal de taxa zero conhecida). |
| 010 | Dia a dia comum | Nuvemshop | Margem saudável e típica, pedido em preparação. |

Cada pedido vai direto ao `ORDER_REPOSITORY.upsert()` (não passa pelo `OrderSyncOrchestrator`, porque não existe canal externo nenhum por trás) com `costPrice` fixo no próprio item — nunca resolvido contra o catálogo real de produtos do tenant, para que a margem de cada cenário seja determinística e não dependa do que está cadastrado na loja de verdade.

**Idempotência:** a chave de negócio `(tenantId, channelCode, externalOrderId)` é a mesma usada por qualquer sync real — rodar `seed()` de novo nunca duplica os 10 pedidos, só atualiza as mesmas 10 linhas.

## 3. Segregação de dados — a flag `isDemo`

`Order.isDemo: Boolean @default(false)` (migração `20260711190000_order_audit_mode`) é o único sinal de que um pedido é fictício. A garantia de "nunca se misturar" pedida no briefing é estrutural, não uma convenção que cada desenvolvedor precisa lembrar de aplicar:

- O filtro `WHERE isDemo = ...` vive na camada mais baixa possível — dentro de `PrismaOrderRepository`, não em cada service que o consome.
- **Ausente = REAL.** Todo método do `OrderRepository` (`findWithFilters`, `countByStatus`, `findAllForPeriod`) recebe um parâmetro opcional `dataMode?: AppDataMode` (`'REAL' | 'DEMO'`). Quando esse parâmetro não é passado — o comportamento de QUALQUER código escrito antes deste recurso, ou qualquer código futuro que esqueça de pensar nisso — o filtro aplicado é `isDemo: false`. Não existe um caminho de código que mostre pedido fictício "sem querer".
- O mesmo parâmetro atravessa `OrdersService` → `OrderFinancialsReader` (porta consumida pelo Financial Intelligence) → `FinancialOrchestrator.generateDreReport`. O DRE (Etapa 20) tem exatamente a mesma garantia: sem `dataMode: 'DEMO'` explícito, os 10 pedidos de demonstração NUNCA entram no relatório financeiro real da Rita Mazzei Beauty.
- Limpeza: `deleteDemoOrders(tenantId)` executa `WHERE tenantId = ? AND isDemo = true` — explícito, nunca "todos menos os reais" (uma inversão de lógica ali apagaria dado de produção, o pior cenário possível para este recurso).

## 4. Endpoints (`/audit-mode`, ADMIN-only)

```
GET  /audit-mode/status   -> { totalDemoOrders: number }
POST /audit-mode/seed     -> { seeded: 10, externalOrderIds: [...] }   (idempotente)
POST /audit-mode/clear    -> { removed: number }
```

Os três exigem `JwtAuthGuard` + `RolesGuard` + `@Roles(UserRole.ADMIN)` — a mesma exigência dos endpoints de conexão OAuth2 (`docs/auth-security.md`). Semear/limpar dados fictícios é uma operação de infraestrutura de teste, não uma ação do dia a dia de um operador comum.

Os endpoints de leitura existentes ganharam um parâmetro de query opcional `mode` (`REAL`/`DEMO`, ausente = `REAL`):

```
GET /orders?mode=DEMO
GET /orders/status-counts?mode=DEMO
GET /financial-intelligence/dre?mode=DEMO
```

## 5. Interface de controle (frontend)

- `AppModeProvider` / `useAppMode()` (`apps/web/src/features/app-mode/app-mode-context.tsx`) — mesmo padrão de Context de `AuthProvider`/`useAuth`. Mantém `mode` (`'REAL' | 'DEMO'`) em memória + `localStorage`, e expõe `canToggle` (true só quando `user.role === 'ADMIN'`).
- **Botão discreto no Dashboard** (`AppModeToggle`, canto do hero) — só renderiza algo para Admin; para qualquer outro papel, o componente devolve `null` (nem um botão desabilitado aparece, para não sugerir uma funcionalidade que aquele usuário não pode usar). Abre um pequeno painel com: alternância Real/Demo, contagem de pedidos de demonstração já semeados, e os botões "Semear" / "Limpar".
- **Recarrega os dados da tela** ao trocar de modo: `mode` entra na `queryKey` do react-query em toda tela que lê pedidos (`OrderTable`, `DashboardPage`) — trocar o modo nunca reaproveita uma página de cache do modo anterior; `setMode` também invalida todo o cache de query (`queryClient.invalidateQueries()`), garantindo um refetch limpo.
- Um aviso visual (`Modo Demonstração ativo — ...`) aparece no topo do Dashboard e da worklist de Pedidos sempre que `mode === 'DEMO'`, para que ninguém confunda um número de demonstração com um número real durante uma apresentação.

## 6. O que falta / simplificações conscientes

- Sem revogação de sessão entre trocar de tenant/usuário no mesmo navegador além do que `localStorage` + o guard `canToggle` já cobrem — um Admin que compartilha a mesma máquina com outro usuário não-Admin nunca vê o toggle, mas a chave de `localStorage` não é namespaced por usuário (`kyneti.appMode` é única por navegador, não por sessão). Não é um problema de vazamento de dado (o backend sempre reforça `ADMIN` nos endpoints de escrita, e `AppModeProvider` força `REAL` no primeiro render para qualquer não-Admin), só uma pequena aspereza de UX em máquinas compartilhadas.
- O relatório DRE (`/financial-intelligence/dre?mode=DEMO`) já aceita e repassa o parâmetro corretamente, mas não há ainda uma tela no frontend que consuma esse endpoint — o Dashboard hoje lê métricas agregadas direto de `GET /orders`, não do DRE.
- Os 10 cenários cobrem margem positiva/negativa, frete alto, taxa alta/variada (pedido original) mais três cenários extras (cancelado, custo desconhecido, taxa suspeita) que exercitam a Regra de Ouro de integridade de dados da Etapa 20 — não há um cenário de pedido MULTI-item nem de múltiplos itens do mesmo SKU, que já são cobertos por outros testes automatizados (não pelo Audit Mode).

Testes: `audit-seeder.service.spec.ts` (10 pedidos exatos, todos `isDemo: true`, cenários de margem positiva/negativa/frete alto/taxa alta, pedido cancelado + custo desconhecido, taxa suspeita fora da Nuvemshop, idempotência ao rodar duas vezes, `clear`/`getStatus`), mais os testes atualizados de `prisma-order.repository` (via `orders.service.spec.ts`/`order-sync-orchestrator.service.spec.ts`/`order-margin.spec.ts`, todos com `isDemo` no fixture) e `financial-orchestrator.service.spec.ts` (repasse de `dataMode` ao `OrderFinancialsReader`).
